// project-io.js - save/open a fighter project (.mafighter = zip of JSON + PNGs).
import { writeZip, readZipAsync } from '../zip.js';
import { encodePNGAsync } from '../png.js';
import { download } from '../ui.js';
import { newProject, POSES } from './state.js';

const enc = new TextEncoder(), dec = new TextDecoder();

async function png(img) { return encodePNGAsync(img.width, img.height, img.data); }
async function grayPNG(arr, w, h, map) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < arr.length; i++) { const v = map(arr[i]); rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255; }
  return encodePNGAsync(w, h, rgba);
}
async function readPNG(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  return x.getImageData(0, 0, bmp.width, bmp.height);
}

export async function saveProject(ctx) {
  const p = ctx.p; const entries = [];
  const meta = { ...p, clips: {}, cut: { ...p.cut, plate: !!p.cut.plate }, projectile: { ...p.projectile, frames: p.projectile.frames.length } };
  for (const [id, c] of Object.entries(p.clips)) {
    meta.clips[id] = { id, name: c.name, w: c.w, h: c.h, fps: c.fps, source: c.source, alpha: c.alpha, method: c.method, keyColor: c.keyColor, anchor: c.anchor, scale: c.scale, borrowed: c.borrowed, count: c.frames.length,
      hasMask: c.masks.map(Boolean), hasEdit: c.edits.map(Boolean), hasPaint: c.paint.map(Boolean) };
    for (let i = 0; i < c.frames.length; i++) {
      entries.push({ name: `clips/${id}/f${i}.png`, data: await png(c.frames[i]) });
      if (c.masks[i]) entries.push({ name: `clips/${id}/m${i}.png`, data: await grayPNG(c.masks[i], c.w, c.h, v => v) });
      if (c.edits[i]) entries.push({ name: `clips/${id}/e${i}.png`, data: await grayPNG(c.edits[i], c.w, c.h, v => (v > 0 ? 255 : v < 0 ? 0 : 128)) });
      if (c.paint[i]) entries.push({ name: `clips/${id}/p${i}.png`, data: await png(c.paint[i]) });
    }
  }
  if (p.cut.plate) entries.push({ name: 'plate.png', data: await png(p.cut.plate) });
  for (let i = 0; i < p.projectile.frames.length; i++) if (p.projectile.frames[i]) entries.push({ name: `projectile/${i}.png`, data: await png(p.projectile.frames[i]) });
  entries.unshift({ name: 'project.json', data: enc.encode(JSON.stringify(meta)) });
  const name = (p.profile.name || 'fighter').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'fighter';
  download(`${name}.mafighter`, writeZip(entries), 'application/zip');
}

export async function openProject(file, progress) {
  const files = await readZipAsync(new Uint8Array(await file.arrayBuffer()));
  if (!files['project.json']) throw new Error('project.json is missing');
  const meta = JSON.parse(dec.decode(files['project.json']));
  const p = Object.assign(newProject(), meta, { clips: {} });
  const ids = Object.keys(meta.clips); let k = 0;
  for (const id of ids) {
    const m = meta.clips[id]; progress && progress(`Opening ${m.name}...`, k++ / ids.length);
    const frames = [], masks = [], edits = [], paint = [];
    for (let i = 0; i < m.count; i++) {
      frames.push(await readPNG(files[`clips/${id}/f${i}.png`]));
      masks.push(m.hasMask[i] ? (await readPNG(files[`clips/${id}/m${i}.png`])).data.filter((_, j) => j % 4 === 0) : null);
      if (m.hasEdit[i]) { const g = (await readPNG(files[`clips/${id}/e${i}.png`])).data; const e = new Int8Array(m.w * m.h); for (let j = 0; j < e.length; j++) e[j] = g[j * 4] > 190 ? 1 : g[j * 4] < 64 ? -1 : 0; edits.push(e); } else edits.push(null);
      paint.push(m.hasPaint[i] ? await readPNG(files[`clips/${id}/p${i}.png`]) : null);
    }
    p.clips[id] = { ...m, frames, masks: masks.map(x => x && new Uint8Array(x)), edits, paint, ver: 1 };
    delete p.clips[id].hasMask; delete p.clips[id].hasEdit; delete p.clips[id].hasPaint; delete p.clips[id].count;
  }
  p.cut.plate = files['plate.png'] ? await readPNG(files['plate.png']) : null;
  const n = meta.projectile.frames || 0; p.projectile.frames = [];
  for (let i = 0; i < n; i++) p.projectile.frames.push(files[`projectile/${i}.png`] ? await readPNG(files[`projectile/${i}.png`]) : null);
  for (const pose of POSES) if (p.poses[pose.id] && !p.clips[p.poses[pose.id]]) p.poses[pose.id] = null;
  return p;
}
