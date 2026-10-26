// Decodes idle animations of two stock OpenMortal fighters into small sprite strips for the
// title screen, straight from the game's own .dat files (proves the format reader too).
// usage: node tools/extract-attract.mjs <OpenMortal/data/characters>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readDatafile } from '../public/js/omformat.js';
import { encodePNG } from '../public/js/png.js';

const dir = process.argv[2];
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img');
const manifest = {};
for (const [name, group] of [['UPi', 'stand'], ['Zoli', 'stand'], ['Kinga', 'stand'], ['Grizli', 'stand']]) {
  const pl = fs.readFileSync(path.join(dir, `${name}.pl`), 'latin1');
  const txt = fs.readFileSync(path.join(dir, `${name}.dat.txt`), 'latin1').trim().split('\n');
  const [, px, py] = /LoadFrames\(\s*"[^"]+"\s*,\s*(-?\d+)\s*,\s*(-?\d+)/.exec(pl).map(Number);
  const items = [.../CreateFrameLookup\((.*?)\);/s.exec(pl)[1].matchAll(/["'](\w+)["'],\s*(\d+)/g)].map(m => [m[1], +m[2]]);
  let idx = 0, start = -1, count = 0;
  for (const [g, n] of items) { if (g === group) { start = idx; count = n; break; } idx += n; }
  const { palette, frames } = readDatafile(fs.readFileSync(path.join(dir, `${name}.dat`)));
  const sel = [];
  for (let i = start; i < start + count; i++) {
    const g = k => +new RegExp(`'${k}'=>\\s*(-?\\d+)`).exec(txt[i])[1];
    sel.push({ f: frames[i], x: g('x') - px, y: g('y') - py });
  }
  // common box so frames line up
  const x0 = Math.min(...sel.map(s => s.x)), y0 = Math.min(...sel.map(s => s.y));
  const x1 = Math.max(...sel.map(s => s.x + s.f.w)), y1 = Math.max(...sel.map(s => s.y + s.f.h));
  const W = x1 - x0, H = y1 - y0;
  const strip = new Uint8ClampedArray(W * sel.length * H * 4);
  sel.forEach((s, k) => {
    for (let y = 0; y < s.f.h; y++) for (let x = 0; x < s.f.w; x++) {
      const c = s.f.px[y * s.f.w + x]; if (!c) continue;
      const o = ((y + s.y - y0) * W * sel.length + k * W + (x + s.x - x0)) * 4;
      const p = palette[c]; strip[o] = p[0]; strip[o + 1] = p[1]; strip[o + 2] = p[2]; strip[o + 3] = 255;
    }
  });
  fs.writeFileSync(path.join(OUT, `attract-${name}.png`), encodePNG(W * sel.length, H, strip, zlib.deflateSync));
  manifest[name] = { w: W, h: H, frames: sel.length, anchorX: -x0, feetY: 290 - y0 };
  console.log(name, group, sel.length, 'frames', W + 'x' + H);
}
fs.writeFileSync(path.join(OUT, 'attract.json'), JSON.stringify(manifest, null, 1));
