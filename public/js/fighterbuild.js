// fighterbuild.js - turns masked RGBA frames into a complete OpenMortal fighter.
// Pure JS (no DOM) so it can run in a Worker, on the main thread, or in Node for tests.
import { GROUPS, GROUP_IDS, GROUP_BY_ID, STAND_HEIGHT, FEET_Y, writeDatafile, buildDatTxt, buildFighterPl, sanitizeCodename } from './omformat.js';
import { buildPalette, makeMapper } from './quantize.js';

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

/** Bilinear resize of an RGBA image with premultiplied alpha. */
export function resizeRGBA(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const sx = sw / dw, sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      let r = 0, g = 0, b = 0, a = 0;
      const taps = [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)], [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]];
      for (const [px, py, w] of taps) {
        if (w === 0) continue; const i = (py * sw + px) * 4; const al = src[i + 3] * w;
        r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al;
      }
      const o = (y * dw + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a;
    }
  }
  return out;
}

export function flipRGBA(src, w, h) {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, o = (y * w + (w - 1 - x)) * 4;
    out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2]; out[o + 3] = src[i + 3];
  }
  return out;
}

/** Bounding box of pixels with alpha >= thr, or null. */
export function alphaBounds(rgba, w, h, thr = 128) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] >= thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Normalizes one masked source frame into fighter space.
 * opts: { scale, anchorX, baseY, flip }  anchorX/baseY are in source pixels:
 *   anchorX = the fighter's centre line, baseY = the floor line (feet).
 * Returns { w, h, rgba, x, y } where x,y = top-left offset relative to the anchor.
 */
export function normalizeFrame(src, { scale = 1, anchorX = src.w / 2, baseY = src.h, flip = false } = {}) {
  let rgba = src.rgba, w = src.w, h = src.h, ax = anchorX;
  if (flip) { rgba = flipRGBA(rgba, w, h); ax = w - anchorX; }
  const b = alphaBounds(rgba, w, h, 8);
  if (!b) return null;
  // crop with a 2px margin before scaling (keeps resampling cheap)
  const m = 2, cx0 = Math.max(0, b.x0 - m), cy0 = Math.max(0, b.y0 - m), cx1 = Math.min(w - 1, b.x1 + m), cy1 = Math.min(h - 1, b.y1 + m);
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) crop.set(rgba.subarray(((cy0 + y) * w + cx0) * 4, ((cy0 + y) * w + cx0 + cw) * 4), y * cw * 4);
  const dw = Math.max(1, Math.round(cw * scale)), dh = Math.max(1, Math.round(ch * scale));
  const out = scale === 1 ? crop : resizeRGBA(crop, cw, ch, dw, dh);
  // tighten to the solid area after scaling
  const tb = alphaBounds(out, dw, dh, 128);
  if (!tb) return null;
  const fw = tb.x1 - tb.x0 + 1, fh = tb.y1 - tb.y0 + 1;
  const fin = new Uint8ClampedArray(fw * fh * 4);
  for (let y = 0; y < fh; y++) fin.set(out.subarray(((tb.y0 + y) * dw + tb.x0) * 4, ((tb.y0 + y) * dw + tb.x0 + fw) * 4), y * fw * 4);
  return {
    w: fw, h: fh, rgba: fin,
    x: Math.round((cx0 - ax) * scale) + tb.x0,
    y: Math.round((cy0 - baseY) * scale) + tb.y0 + FEET_Y,
  };
}

// ---------------------------------------------------------------------------
// Automatic hit boxes
// ---------------------------------------------------------------------------
function rowExtents(f) {
  const rows = [];
  for (let y = 0; y < f.h; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < f.w; x++) if (f.rgba[(y * f.w + x) * 4 + 3] >= 128) { if (a < 0) a = x; b = x; }
    rows.push(a < 0 ? null : [a, b]);
  }
  return rows;
}

function bandBox(rows, f, from, to, trim = 0.15) {
  const y0 = Math.max(0, Math.floor(from)), y1 = Math.min(f.h - 1, Math.ceil(to));
  const lefts = [], rights = [];
  for (let y = y0; y <= y1; y++) if (rows[y]) { lefts.push(rows[y][0]); rights.push(rows[y][1]); }
  if (!lefts.length) return null;
  lefts.sort((a, b) => a - b); rights.sort((a, b) => a - b);
  const q = (arr, t) => arr[Math.min(arr.length - 1, Math.floor(arr.length * t))];
  return { x0: q(lefts, trim), x1: q(rights, 1 - trim), y0, y1 };
}

const quad = (b, ox, oy) => [b.x0 + ox, b.y0 + oy, b.x1 + ox, b.y0 + oy, b.x1 + ox, b.y1 + oy, b.x0 + ox, b.y1 + oy];

/** Adds head/body/legs polygons (fighter-space coords) to a normalized frame. */
export function autoBoxes(f) {
  const rows = rowExtents(f);
  const H = f.h;
  // A standing fighter is ~300px. Shorter frames (crouches) keep a head-sized head box.
  const headH = Math.min(H * 0.22, STAND_HEIGHT * 0.17);
  const head = bandBox(rows, f, 0, headH, 0.2) || { x0: 0, x1: f.w - 1, y0: 0, y1: Math.max(1, headH) };
  // narrow very wide "heads" (arms raised above the head) to the middle 45px
  if (head.x1 - head.x0 > 60) { const c = (head.x0 + head.x1) / 2; head.x0 = Math.round(c - 22); head.x1 = Math.round(c + 22); }
  const body = bandBox(rows, f, headH * 0.8, H * 0.58, 0.15) || { x0: 0, x1: f.w - 1, y0: Math.round(headH), y1: Math.round(H * 0.58) };
  const legs = bandBox(rows, f, H * 0.52, H - 1, 0.1) || { x0: 0, x1: f.w - 1, y0: Math.round(H * 0.52), y1: H - 1 };
  f.head = quad(head, f.x, f.y); f.body = quad(body, f.x, f.y); f.legs = quad(legs, f.x, f.y);
  f._rows = rows;
  return f;
}

/** Forward reach of a frame within a height band [from,to] (fractions of frame height). */
function reach(f, from, to) {
  const rows = f._rows || rowExtents(f);
  let best = -1e9, by = 0;
  for (let y = Math.floor(f.h * from); y <= Math.min(f.h - 1, Math.ceil(f.h * to)); y++) {
    if (rows[y] && rows[y][1] > best) { best = rows[y][1]; by = y; }
  }
  return { x: best + f.x, y: by + f.y };
}

const BANDS = { punch: [0.08, 0.5], uppercut: [0.0, 0.35], kick: [0.15, 0.75], lowkick: [0.45, 1.0] };

/** Picks the frame of an attack with the longest forward reach and gives it a 'hit' polygon. */
export function autoHit(frames, kind, { size = 34 } = {}) {
  if (!frames.length) return -1;
  const [a, b] = BANDS[kind] || BANDS.punch;
  // baseline reach = body edge of the first frame (the wind-up)
  let bi = -1, bx = -1e9, by = 0;
  frames.forEach((f, i) => { const r = reach(f, a, b); if (r.x > bx) { bx = r.x; by = r.y; bi = i; } });
  if (bi < 0) bi = Math.floor(frames.length / 2);
  const f = frames[bi];
  const tipX = bx, tipY = by;
  // Convex quad around the fist/foot. The first vertex sits at the tip because
  // CreateDoodad spawns projectiles at (hit[0], hit[1]).
  const hh = Math.round(size / 2);
  f.hit = [tipX + 4, tipY - hh, tipX + 4, tipY + hh, tipX - size, tipY + hh, tipX - size, tipY - hh];
  return bi;
}

// ---------------------------------------------------------------------------
// Fighter assembly
// ---------------------------------------------------------------------------

/**
 * spec = {
 *   codename, id, gender, stats,
 *   groups: { groupId: [normalizedFrame, ...] }   (frames may be shared between groups; they are copied)
 *   hitFrames: { groupId: index }                   (optional manual pick of the impact frame)
 *   boxes: { groupId: [ {head, body, legs, hit}|null ] } (optional manual polygons)
 *   timing, special, projectile (see buildFighterPl)
 *   paintColors: [[r,g,b]...]   colours from the paint tool that must stay exact
 * }
 * Returns { files: { 'X.dat': Uint8Array, 'X.dat.txt': string, 'X.pl': string }, palette, frames, counts }
 */
export function assembleFighter(spec) {
  const codename = sanitizeCodename(spec.codename);
  const order = [];       // final frame list in .dat order
  const counts = {};
  for (const gid of GROUP_IDS) {
    const list = (spec.groups[gid] || []).filter(Boolean);
    counts[gid] = list.length;
    if (!list.length) continue;
    const copies = list.map((f, i) => {
      const c = { w: f.w, h: f.h, rgba: f.rgba, x: f.x, y: f.y, group: gid, n: i + 1, doodad: gid === 'shotdoodad' };
      const manual = spec.boxes && spec.boxes[gid] && spec.boxes[gid][i];
      if (c.doodad) {
        // projectile sprites: drawn at the doodad position; dummy body boxes are required by the engine
        c.x = 0; c.y = 0;
        const box = [0, 0, c.w, 0, c.w, c.h, 0, c.h]; c.head = box; c.body = box; c.legs = box;
      } else {
        autoBoxes(c);
        if (manual) Object.assign(c, Object.fromEntries(Object.entries(manual).filter(([, v]) => v)));
      }
      return c;
    });
    const g = GROUP_BY_ID[gid];
    if (g.attack) {
      const manualHit = spec.boxes && spec.boxes[gid] && spec.boxes[gid].some(b => b && b.hit);
      if (!manualHit) {
        const pick = spec.hitFrames && Number.isInteger(spec.hitFrames[gid]) ? spec.hitFrames[gid] : null;
        if (pick !== null && copies[pick]) {
          const one = [copies[pick]]; autoHit(one, g.attack);
        } else autoHit(copies, g.attack);
      }
    }
    order.push(...copies);
  }
  for (const g of GROUPS) if (g.need && !counts[g.id]) throw new Error(`Missing animation: ${g.label} (${g.id})`);

  // palette: index 0 transparent, 1..63 colours
  let total = 0; for (const f of order) total += f.w * f.h;
  const step = Math.max(1, Math.floor(total / 120000));
  const samples = []; let k = 0;
  for (const f of order) {
    for (let i = 0; i < f.w * f.h; i++, k++) {
      if (k % step || f.rgba[i * 4 + 3] < 128) continue;
      samples.push(f.rgba[i * 4], f.rgba[i * 4 + 1], f.rgba[i * 4 + 2]);
    }
  }
  const fixed = (spec.paintColors || []).slice(0, 24);
  const pal63 = buildPalette(new Uint8Array(samples), 63, fixed);
  while (pal63.length < 63) pal63.push([0, 0, 0]);
  const palette = [[255, 255, 255], ...pal63];
  const map = makeMapper(pal63);

  const datFrames = order.map(f => {
    const px = new Uint8Array(f.w * f.h);
    for (let i = 0; i < px.length; i++) {
      const o = i * 4; if (f.rgba[o + 3] < 128) continue;
      px[i] = 1 + map(f.rgba[o], f.rgba[o + 1], f.rgba[o + 2]);
    }
    return { w: f.w, h: f.h, px };
  });
  const dat = writeDatafile(palette, datFrames);
  const txt = buildDatTxt(order);
  const pl = buildFighterPl({
    codename, id: spec.id, gender: spec.gender, stats: spec.stats, counts, timing: spec.timing,
    special: spec.special, projectile: spec.projectile, datasize: dat.length,
  });
  return { codename, files: { [`${codename}.dat`]: dat, [`${codename}.dat.txt`]: txt, [`${codename}.pl`]: pl }, palette, frames: order, datFrames, counts };
}

// ---------------------------------------------------------------------------
// Portraits (icon 75x75 for the select grid, full-body for the select screen)
// Returned as RGBA buffers; the caller encodes them to PNG/JPEG.
// ---------------------------------------------------------------------------
export function makePortraits(stance, { bg = [[70, 18, 18], [18, 6, 6]] } = {}) {
  const f = stance;
  // full body: fit into 115 x 309
  const fs = Math.min(115 / f.w, 309 / f.h, 1.2);
  const fw = Math.max(1, Math.round(f.w * fs)), fh = Math.max(1, Math.round(f.h * fs));
  const full = { w: fw, h: fh, rgba: resizeRGBA(f.rgba, f.w, f.h, fw, fh) };
  // icon: square around the head (top ~22% of the body), on a dark red gradient like the stock portraits
  const rows = f._rows || rowExtents(f);
  const headH = Math.round(Math.min(f.h * 0.3, STAND_HEIGHT * 0.26));
  const hb = bandBox(rows, f, 0, headH, 0.25) || { x0: 0, x1: f.w - 1 };
  const side = Math.max(headH, hb.x1 - hb.x0 + 16);
  const cx = (hb.x0 + hb.x1) / 2, sx0 = Math.round(cx - side / 2), sy0 = -Math.round(side * 0.08);
  const crop = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const t = y / side; const o = (y * side + x) * 4;
    const c0 = bg[0], c1 = bg[1];
    let r = c0[0] + (c1[0] - c0[0]) * t, g = c0[1] + (c1[1] - c0[1]) * t, b = c0[2] + (c1[2] - c0[2]) * t;
    const X = sx0 + x, Y = sy0 + y;
    if (X >= 0 && Y >= 0 && X < f.w && Y < f.h) {
      const i = (Y * f.w + X) * 4, a = f.rgba[i + 3] / 255;
      r = r * (1 - a) + f.rgba[i] * a; g = g * (1 - a) + f.rgba[i + 1] * a; b = b * (1 - a) + f.rgba[i + 2] * a;
    }
    crop[o] = r; crop[o + 1] = g; crop[o + 2] = b; crop[o + 3] = 255;
  }
  const icon = { w: 75, h: 75, rgba: resizeRGBA(crop, side, side, 75, 75) };
  return { icon, full };
}
