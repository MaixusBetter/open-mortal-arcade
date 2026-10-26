// build.js - turns the project into a real OpenMortal fighter (in a Worker) and ships it.
import { STAND_HEIGHT, sanitizeCodename } from '../omformat.js';
import { resolveGroups } from './state.js';
import { composite, withEdits, anchorFromMask } from './cutout.js';
import { writeZip } from '../zip.js';
import { encodeGIF } from '../gif.js';
import { buildPalette, makeMapper } from '../quantize.js';

export function stanceHeight(p) {
  const c = p.clips[p.poses.stance]; if (!c || !c.masks[0] || c.source === 'borrow') return 0;
  return anchorFromMask(withEdits(c.masks[0], c.edits[0]), c.w, c.h).height;
}

export function clipTransform(p, clip) {
  const a = clip.anchor || (clip.masks[0] ? anchorFromMask(withEdits(clip.masks[0], clip.edits[0]), clip.w, clip.h) : { x: clip.w / 2, y: clip.h - 1 });
  let scale = clip.scale;
  if (scale == null) { const sh = stanceHeight(p); scale = p.scale || (sh ? STAND_HEIGHT / sh : 1); }
  return { scale, anchorX: a.x, baseY: a.y, flip: !!p.flip && clip.source !== 'borrow' };
}

/** Animation groups for export, with the special-move rules applied. */
export function exportGroups(p) {
  const g = resolveGroups(p);
  const sp = p.special || {};
  const special = p.poses.special && p.clips[p.poses.special];
  const punch = p.poses.punch && p.clips[p.poses.punch];
  const all = c => c.frames.map((_, i) => ({ clip: c.id, index: i }));
  if (sp.kind === 'projectile') {
    // the throw animation (special pose, else the punch) fires the projectile; no separate strike
    if (!p.groups.grenade) { if (special) g.grenade = all(special); else if (punch) g.grenade = all(punch); }
    delete g.special;
  } else {
    // a big strike: the special pose (if filmed) knocks them down; the throw slot is a plain punch
    if (punch && !p.groups.grenade) g.grenade = all(punch);
    if (!special) delete g.special;
  }
  return g;
}

export function projectileFrames(p) {
  const fr = (p.projectile.frames || []).filter(f => f && f.data.some((v, i) => (i & 3) === 3 && v));
  return fr;
}

function cropAlpha(img) {
  const { width: w, height: h, data: d } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.set(d.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + cw) * 4), y * cw * 4);
  return { w: cw, h: ch, rgba: out, x0, y0 };
}

function paintColors(p) {
  const set = new Map();
  const add = img => { if (!img) return; const d = img.data; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; set.set(k, (set.get(k) || 0) + 1); } };
  for (const c of Object.values(p.clips)) for (const pl of c.paint) add(pl);
  for (const f of p.projectile.frames || []) add(f);
  return [...set.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
}

let worker = null;
function getWorker() {
  if (!worker) worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  return worker;
}

/** Builds the fighter. Returns { codename, files, frames, counts, palette }. */
export async function buildFighter(p, { onProgress, id = null } = {}) {
  // a stable, random ID so packs from different people don't collide in one OpenMortal install
  // (the arcade server renumbers fighters from 200 up anyway)
  if (!p.fighterId) p.fighterId = 300 + Math.floor(Math.random() * 29000);
  id = id || p.fighterId;
  const groups = exportGroups(p);
  const unique = new Map();     // "clip:index" -> payload
  const transfer = [];
  // frames whose cutout came out empty borrow the nearest good frame of the same clip
  const empty = (clip, i) => { const m = clip.masks[i] ? withEdits(clip.masks[i], clip.edits[i]) : null; if (!m) return false; for (let k = 0; k < m.length; k += 7) if (m[k]) return false; return !clip.paint[i]; };
  for (const [gid, refs] of Object.entries(groups)) groups[gid] = refs.map(r => {
    const clip = p.clips[r.clip]; if (!empty(clip, r.index)) return r;
    for (let d = 1; d < clip.frames.length; d++) for (const j of [r.index - d, r.index + d]) if (j >= 0 && j < clip.frames.length && !empty(clip, j)) return { clip: r.clip, index: j };
    return r;
  });
  for (const refs of Object.values(groups)) for (const r of refs) {
    const key = `${r.clip}:${r.index}`; if (unique.has(key)) continue;
    const clip = p.clips[r.clip];
    const img = composite(clip, r.index);
    const c = cropAlpha(img);
    if (!c) { unique.set(key, null); continue; }
    const t = clipTransform(p, clip);
    // the crop moved the origin: express the anchor relative to the cropped image
    const flipAnchor = t.flip;
    unique.set(key, { w: c.w, h: c.h, rgba: c.rgba, t: { scale: t.scale, flip: flipAnchor, anchorX: t.anchorX - c.x0, baseY: t.baseY - c.y0, srcW: clip.w, x0: c.x0 } });
    transfer.push(c.rgba.buffer);
  }
  const proj = projectileFrames(p).map(f => ({ w: f.width, h: f.height, rgba: new Uint8ClampedArray(f.data) }));
  const codename = sanitizeCodename(p.profile.name || 'Fighter');
  const msg = {
    unique: [...unique.entries()], groups, proj,
    spec: {
      codename, id, gender: p.profile.gender, timing: p.timing,
      stats: { name: p.profile.name || codename, team: p.profile.team, style: p.profile.style, age: p.profile.age, weight: p.profile.weight, height: p.profile.height, shoe: p.profile.shoe, story: p.profile.story },
      special: p.special.kind === 'strike' ? { combo: p.special.combo, hit: 'Uppercut', label: p.special.label || 'Special move', quake: p.special.quake, quakeFrame: 3 } : null,
      projectile: p.special.kind === 'projectile' && proj.length ? { combo: p.special.combo, label: p.special.label || 'Projectile', speed: p.projectile.speed, lift: p.projectile.lift, gravity: p.projectile.gravity, w: 48, h: 48, animDel: 4 } : null,
      paintColors: paintColors(p),
      boxes: p.boxes || {},
    },
    script: p.script,
  };
  const w = getWorker();
  return new Promise((resolve, reject) => {
    w.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') onProgress && onProgress(m.text, m.value);
      else if (m.type === 'done') resolve(m.result);
      else if (m.type === 'error') reject(new Error(m.error));
    };
    w.onerror = e => reject(new Error(e.message || 'The fighter builder crashed.'));
    w.postMessage(msg, transfer);
  });
}

export function packZip(result) {
  const readme = `${result.codename} - an OpenMortal 0.7 fighter made with Mortal Arcade (uOttawa Game Development Club)

To play it in OpenMortal on your own computer:
1. Copy every ${result.codename}.* file into OpenMortal's data/characters folder.
2. Start OpenMortal (on Windows 10/11 use the "Play OpenMortal" launcher from the Windows 11 fix).
3. ${result.codename} appears on the fighter select screen.

Files: ${result.codename}.dat (sprites + palette, Allegro datafile), ${result.codename}.dat.txt (frame offsets and hit boxes),
${result.codename}.pl (moves and states, Perl), ${result.codename}.icon.png and ${result.codename}.full.png (portraits).
`;
  return writeZip([...Object.entries(result.files).map(([name, data]) => ({ name, data })), { name: 'README.txt', data: readme }]);
}

/** Animated GIF of one animation, using the frames exactly as they go into the game. */
export function gifForGroup(result, gid, { scale = 1, bg = null } = {}) {
  const fr = result.frames.filter(f => f.group === gid);
  if (!fr.length) return null;
  const x0 = Math.min(...fr.map(f => f.x)) - 4, y0 = Math.min(...fr.map(f => f.y)) - 4;
  const x1 = Math.max(...fr.map(f => f.x + f.w)) + 4, y1 = Math.max(...fr.map(f => f.y + f.h)) + 4;
  const W = x1 - x0, H = y1 - y0;
  const samples = [];
  for (const f of fr) for (let i = 0; i < f.w * f.h; i += 3) if (f.rgba[i * 4 + 3] > 128) samples.push(f.rgba[i * 4], f.rgba[i * 4 + 1], f.rgba[i * 4 + 2]);
  const pal = buildPalette(new Uint8Array(samples), 255); const map = makeMapper(pal);
  const delay = Math.max(4, Math.round((result.timing[gid] || 5) * 1.2));
  const frames = fr.map(f => {
    const px = new Uint8Array(W * H);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const o = (y * f.w + x) * 4; if (f.rgba[o + 3] < 128) continue;
      px[(y + f.y - y0) * W + (x + f.x - x0)] = 1 + map(f.rgba[o], f.rgba[o + 1], f.rgba[o + 2]);
    }
    return { px, delay };
  });
  return encodeGIF(W, H, frames, [[0, 0, 0], ...pal]);
}
