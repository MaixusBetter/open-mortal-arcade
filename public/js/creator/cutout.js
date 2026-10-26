// cutout.js - background removal for fighter footage.
// Methods: 'ai' (MediaPipe person segmentation, runs locally), 'key' (green/blue screen),
// 'plate' (difference from an empty-background shot), 'alpha' (already transparent).
// Every method gives a 0-255 probability map; refine() turns it into a clean mask, and
// manual brush edits (+1 keep / -1 remove) are applied on top so they survive re-runs.

// ---------------------------------------------------------------------------
// MediaPipe selfie segmentation (Apache-2.0), loaded from /vendor on first use
// ---------------------------------------------------------------------------
let segPromise = null;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.append(s); });
}
export function aiAvailable() { return typeof document !== 'undefined'; }

const VENDOR = new URL('../../vendor/mediapipe/', import.meta.url).href;
async function getSegmenter() {
  if (!segPromise) segPromise = (async () => {
    await loadScript(VENDOR + 'selfie_segmentation.js');
    const seg = new window.SelfieSegmentation({ locateFile: f => VENDOR + f });
    seg.setOptions({ modelSelection: 0, selfieMode: false });
    let pending = null;
    seg.onResults(r => { if (pending) { const p = pending; pending = null; p(r); } });
    await seg.initialize();
    return {
      async run(canvas) {
        const done = new Promise(res => { pending = res; });
        await seg.send({ image: canvas });
        return done;
      },
    };
  })().catch(e => { segPromise = null; throw e; });
  return segPromise;
}

const scratch = {};
function canvasFor(key, w, h) {
  let c = scratch[key];
  if (!c) { c = scratch[key] = document.createElement('canvas'); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

export async function probAI(frame) {
  const seg = await getSegmenter();
  const { width: w, height: h } = frame;
  // the model works best on a padded square around the person
  const [src, sctx] = canvasFor('src', w, h); sctx.putImageData(frame, 0, 0);
  const r = await seg.run(src);
  const [m, mctx] = canvasFor('mask', w, h);
  mctx.clearRect(0, 0, w, h); mctx.drawImage(r.segmentationMask, 0, 0, w, h);
  const d = mctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(d[i * 4], d[i * 4 + 3] < 255 ? d[i * 4 + 3] : 0);
  return out;
}

// ---------------------------------------------------------------------------
// Colour math (YCbCr, 0-255)
// ---------------------------------------------------------------------------
const Y = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const CB = (r, g, b) => 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
const CR = (r, g, b) => 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

/** Finds a coloured screen (green/blue backdrop): the most common saturated colour in the frame. */
export function analyzeBorder(frame) {
  const { width: w, height: h, data: d } = frame;
  const bins = new Float64Array(32 * 32), acc = new Float64Array(32 * 32 * 3);
  let total = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    total++;
    const cb = CB(r, g, b), cr = CR(r, g, b);
    if (Math.hypot(cb - 128, cr - 128) < 9) continue;          // greys, whites, skin-ish lows
    const k = (Math.min(31, cb >> 3) << 5) | Math.min(31, cr >> 3);
    bins[k]++; acc[k * 3] += r; acc[k * 3 + 1] += g; acc[k * 3 + 2] += b;
  }
  // peak with its 8 neighbours
  let best = -1, bestN = 0;
  for (let a = 1; a < 31; a++) for (let c = 1; c < 31; c++) {
    let n = 0; for (let da = -1; da <= 1; da++) for (let dc = -1; dc <= 1; dc++) n += bins[((a + da) << 5) | (c + dc)];
    if (n > bestN) { bestN = n; best = (a << 5) | c; }
  }
  if (best < 0) return { color: [0, 255, 0], uniform: 0, saturation: 0 };
  let n = 0, r = 0, g = 0, b = 0;
  for (let da = -1; da <= 1; da++) for (let dc = -1; dc <= 1; dc++) { const k = best + (da << 5) + dc; n += bins[k]; r += acc[k * 3]; g += acc[k * 3 + 1]; b += acc[k * 3 + 2]; }
  const color = [r / n, g / n, b / n].map(Math.round);
  return { color, uniform: bestN / total, saturation: Math.hypot(CB(...color) - 128, CR(...color) - 128) };
}

export function probKey(frame, key, sensitivity = 50) {
  const { width: w, height: h, data: d } = frame;
  const kcb = CB(...key), kcr = CR(...key);
  // tolerance scales with how colourful the backdrop is (a dull screen needs a tight key)
  const sat = Math.hypot(kcb - 128, kcr - 128);
  const tol = Math.max(5, sat * (0.25 + sensitivity * 0.006)), soft = Math.max(5, sat * 0.35);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const dist = Math.hypot(CB(r, g, b) - kcb, CR(r, g, b) - kcr);
    out[i] = dist <= tol ? 0 : dist >= tol + soft ? 255 : Math.round(255 * (dist - tol) / soft);
  }
  return out;
}

export function probPlate(frame, plate, sensitivity = 50) {
  const { width: w, height: h, data: d } = frame; const p = plate.data;
  const out = new Uint8Array(w * h);
  const thr = 70 - sensitivity * 0.5;     // higher sensitivity = more counts as foreground
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    const r = d[o], g = d[o + 1], b = d[o + 2], pr = p[o], pg = p[o + 1], pb = p[o + 2];
    const dy = Y(r, g, b) - Y(pr, pg, pb);
    const dc = Math.hypot(CB(r, g, b) - CB(pr, pg, pb), CR(r, g, b) - CR(pr, pg, pb));
    // darker with the same chroma = probably a shadow on the floor/wall
    const py = Y(pr, pg, pb) + 1;
    const lum = dy > 0 ? dy : Math.max(0, -dy - 0.38 * py);
    const score = dc * 2.2 + lum;
    out[i] = score <= thr ? 0 : score >= thr + 25 ? 255 : Math.round(255 * (score - thr) / 25);
  }
  return out;
}

export function probAlpha(frame) {
  const { data: d } = frame; const out = new Uint8Array(d.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
  return out;
}

// ---------------------------------------------------------------------------
// Mask clean-up: threshold, drop specks, fill small holes, trim the halo.
// ---------------------------------------------------------------------------
function components(bin, w, h, value) {
  const label = new Int32Array(w * h).fill(-1); const sizes = []; const queue = new Int32Array(w * h);
  for (let s = 0; s < bin.length; s++) {
    if (bin[s] !== value || label[s] !== -1) continue;
    const id = sizes.length; let qh = 0, qt = 0; queue[qt++] = s; label[s] = id; let n = 0; let touches = false, sides = false;
    while (qh < qt) {
      const p = queue[qh++]; n++;
      const x = p % w, y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      if (x === 0 || x === w - 1) sides = true;
      if (x > 0 && bin[p - 1] === value && label[p - 1] === -1) { label[p - 1] = id; queue[qt++] = p - 1; }
      if (x < w - 1 && bin[p + 1] === value && label[p + 1] === -1) { label[p + 1] = id; queue[qt++] = p + 1; }
      if (y > 0 && bin[p - w] === value && label[p - w] === -1) { label[p - w] = id; queue[qt++] = p - w; }
      if (y < h - 1 && bin[p + w] === value && label[p + w] === -1) { label[p + w] = id; queue[qt++] = p + w; }
    }
    sizes.push({ n, touches, sides });
  }
  return { label, sizes };
}

export function refine(prob, w, h, { threshold = 128, keepRatio = 0.12, holeRatio = 0.0025, erode = 1, dropSides = false } = {}) {
  let bin = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) bin[i] = prob[i] >= threshold ? 1 : 0;
  // keep the person (largest blob) plus anything sizeable (a detached arm, a prop)
  const fg = components(bin, w, h, 1);
  if (fg.sizes.length) {
    // walls and furniture at the edges of a green screen touch the sides of the picture; people rarely do
    let cand = fg.sizes.map((s, i) => i);
    if (dropSides && fg.sizes.some(s => !s.sides && s.n > w * h * 0.01)) cand = cand.filter(i => !fg.sizes[i].sides);
    const biggest = Math.max(...cand.map(i => fg.sizes[i].n));
    const keep = fg.sizes.map((s, i) => cand.includes(i) && s.n >= biggest * keepRatio && s.n > 40);
    for (let i = 0; i < bin.length; i++) if (bin[i] && !keep[fg.label[i]]) bin[i] = 0;
  }
  // fill small holes (not the big gap between an arm and the body)
  const bg = components(bin, w, h, 0);
  const maxHole = w * h * holeRatio;
  for (let i = 0; i < bin.length; i++) if (!bin[i]) { const s = bg.sizes[bg.label[i]]; if (!s.touches && s.n < maxHole) bin[i] = 1; }
  // trim one pixel of halo
  for (let e = 0; e < erode; e++) {
    const nb = bin.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; if (!bin[i]) continue;
      if (!bin[i - 1] || !bin[i + 1] || !bin[i - w] || !bin[i + w]) nb[i] = 0;
    }
    bin = nb;
  }
  const out = new Uint8Array(w * h); for (let i = 0; i < out.length; i++) out[i] = bin[i] ? 255 : 0;
  return out;
}

/** AI mask, with backdrop-coloured pixels shaved off its outer 6 px (kills the green halo
 *  without punching holes in green clothes in the middle of the body). */
export function trimEdgesByKey(ai, key, w, h, thr = 128) {
  let bin = new Uint8Array(w * h); for (let i = 0; i < bin.length; i++) bin[i] = ai[i] >= thr ? 1 : 0;
  let core = bin;
  for (let e = 0; e < 6; e++) {
    const nb = core.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (core[i] && (!core[i - 1] || !core[i + 1] || !core[i - w] || !core[i + w])) nb[i] = 0; }
    core = nb;
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = !bin[i] ? 0 : core[i] ? 255 : key[i] < 128 ? 0 : 255;
  return out;
}

/** AI mask plus anything the empty-background difference finds right next to it (stray arms and feet),
 *  ignoring difference noise far from the person (auto exposure, a passer-by). */
export function combineWithAI(ai, plate, w, h, sens = 50) {
  const thr = 255 - Math.round(sens * 2.3) - 8;
  let aiArea = 0, plArea = 0; for (let i = 0; i < ai.length; i++) { if (ai[i] >= thr) aiArea++; if (plate[i] >= 200) plArea++; }
  if (aiArea < plArea * 0.35) return plate;               // the model missed (lying down, odd pose)
  // grow the AI mask by ~16 px with a separable box test
  const R = 16, near = new Uint8Array(w * h), row = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let run = -1e9; for (let x = 0; x < w; x++) { if (ai[y * w + x] >= thr) run = x; if (x - run <= R) row[y * w + x] = 1; } run = 1e9; for (let x = w - 1; x >= 0; x--) { if (ai[y * w + x] >= thr) run = x; if (run - x <= R) row[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let run = -1e9; for (let y = 0; y < h; y++) { if (row[y * w + x]) run = y; if (y - run <= R) near[y * w + x] = 1; } run = 1e9; for (let y = h - 1; y >= 0; y--) { if (row[y * w + x]) run = y; if (run - y <= R) near[y * w + x] = 1; } }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = ai[i] >= thr || (near[i] && plate[i] >= 200) ? 255 : 0;
  return out;
}

/** Applies manual edits (+1 keep / -1 remove) over an automatic mask. */
export function withEdits(mask, edits) {
  if (!edits) return mask;
  const out = mask.slice();
  for (let i = 0; i < out.length; i++) if (edits[i] > 0) out[i] = 255; else if (edits[i] < 0) out[i] = 0;
  return out;
}

/** Removes green/blue spill on edge pixels after a colour-key cut. */
export function despill(frame, key) {
  const d = frame.data;
  const greenKey = key[1] > key[0] && key[1] > key[2];
  for (let i = 0; i < d.length; i += 4) {
    if (greenKey) { const m = Math.max(d[i], d[i + 2]); if (d[i + 1] > m) d[i + 1] = m; }
    else { const m = Math.max(d[i], d[i + 1]); if (d[i + 2] > m) d[i + 2] = m; }
  }
}

/** Picks a method for a clip when the user leaves it on "Auto". */
export function autoMethod(clip, project) {
  if (clip.alpha || clip.source === 'borrow') return 'alpha';
  const a = analyzeBorder(clip.frames[0]);
  if (a.uniform > 0.3 && a.saturation > 12) return 'aikey';
  if (project.cut.plate && project.cut.plate.width === clip.w && project.cut.plate.height === clip.h && clip.source === 'camera') return 'aiplate';
  return 'ai';
}

/** Runs the chosen method on every frame of a clip, filling clip.masks. */
export async function cutClip(clip, project, { onProgress } = {}) {
  const want = project.cut.method === 'auto' ? autoMethod(clip, project) : project.cut.method;
  let method = want;
  if ((method === 'plate' || method === 'aiplate') && !(project.cut.plate && project.cut.plate.width === clip.w && project.cut.plate.height === clip.h)) method = 'ai';
  if (method === 'alpha' && !clip.alpha && clip.source !== 'borrow') method = 'ai';
  const sens = project.cut.sensitivity;
  const key = method === 'key' || method === 'aikey' ? (project.cut.keyColor || analyzeBorder(clip.frames[0]).color) : null;
  for (let i = 0; i < clip.frames.length; i++) {
    const f = clip.frames[i];
    let prob;
    if (method === 'alpha') prob = probAlpha(f);
    else if (method === 'key') prob = probKey(f, key, sens);
    else if (method === 'plate') prob = probPlate(f, project.cut.plate, sens);
    else if (method === 'aiplate') {
      const pl = probPlate(f, project.cut.plate, sens);
      try { prob = combineWithAI(await probAI(f), pl, f.width, f.height, sens); } catch (e) { method = 'plate'; prob = pl; }
    }
    else if (method === 'aikey') {
      try {
        const ai = await probAI(f), k = probKey(f, key, sens);
        const keyMask = refine(k, f.width, f.height, { dropSides: true, erode: 0 });
        let aiArea = 0, keyArea = 0; for (let j = 0; j < ai.length; j++) { if (ai[j] > 128) aiArea++; if (keyMask[j]) keyArea++; }
        // the person model only knows upright people: when it misses (lying down, crouched), trust the screen
        prob = aiArea < keyArea * 0.35 ? keyMask : trimEdgesByKey(ai, k, f.width, f.height, 255 - Math.round(sens * 2.3) - 8);
      } catch (e) { method = 'key'; prob = probKey(f, key, sens); }
    }
    else {
      try { prob = await probAI(f); }
      catch (e) { console.warn('AI cutout unavailable, falling back to background guess', e); method = 'plate-guess'; }
    }
    if (method === 'plate-guess') prob = probPlate(f, clip._guessPlate || (clip._guessPlate = guessPlate(clip)), sens);
    const thr = method === 'ai' ? 255 - Math.round(sens * 2.3) - 8 : 128;
    clip.masks[i] = refine(prob, f.width, f.height, { threshold: Math.max(20, Math.min(235, thr)), erode: method === 'alpha' ? 0 : 1, dropSides: method === 'key' || method === 'aikey' });
    clip.method = method; clip.keyColor = key;
    onProgress && onProgress((i + 1) / clip.frames.length);
    if (i % 2 === 1) await new Promise(r => setTimeout(r, 0));
  }
  return method;
}

/** Background estimate from the clip itself: per-pixel median (works when the fighter moves around). */
export function guessPlate(clip) {
  const fr = clip.frames; const n = Math.min(fr.length, 15);
  const pick = Array.from({ length: n }, (_, i) => fr[Math.round(i * (fr.length - 1) / Math.max(1, n - 1))]);
  const { width: w, height: h } = fr[0]; const out = new ImageData(w, h); const vals = new Uint8Array(n);
  for (let i = 0; i < w * h * 4; i++) {
    if ((i & 3) === 3) { out.data[i] = 255; continue; }
    for (let k = 0; k < n; k++) vals[k] = pick[k].data[i];
    vals.sort(); out.data[i] = vals[n >> 1];
  }
  return out;
}

/** Final RGBA for a clip frame: footage x mask, plus paint on top. */
export function composite(clip, i) {
  const f = clip.frames[i]; const { width: w, height: h } = f;
  const mask = withEdits(clip.masks[i] || new Uint8Array(w * h).fill(255), clip.edits[i]);
  const out = new ImageData(new Uint8ClampedArray(f.data), w, h);
  for (let k = 0; k < w * h; k++) out.data[k * 4 + 3] = Math.min(out.data[k * 4 + 3], mask[k]);
  if ((clip.method === 'key' || clip.method === 'aikey') && clip.keyColor) despill(out, clip.keyColor);
  const paint = clip.paint[i];
  if (paint) {
    const p = paint.data, o = out.data;
    for (let k = 0; k < p.length; k += 4) {
      const a = p[k + 3]; if (!a) continue;
      if (a === 255) { o[k] = p[k]; o[k + 1] = p[k + 1]; o[k + 2] = p[k + 2]; o[k + 3] = 255; }
      else { const t = a / 255; o[k] = o[k] * (1 - t) + p[k] * t; o[k + 1] = o[k + 1] * (1 - t) + p[k + 1] * t; o[k + 2] = o[k + 2] * (1 - t) + p[k + 2] * t; o[k + 3] = Math.max(o[k + 3], a); }
    }
  }
  return out;
}

/** Centre line + floor line from a mask (source pixels). */
export function anchorFromMask(mask, w, h) {
  let minY = h, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  if (maxY < 0) return { x: w / 2, y: h - 1, height: 0 };
  // centre of the lower body band
  const from = Math.round(minY + (maxY - minY) * 0.55); let sx = 0, n = 0;
  for (let y = from; y <= maxY; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { sx += x; n++; }
  return { x: n ? sx / n : w / 2, y: maxY + 1, height: maxY - minY + 1, top: minY };
}
