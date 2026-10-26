// Builds the ghost-pose guides shown in the Easy-mode photo booth from a stock fighter's
// real frames (Zoli, "Boxer"). Output: public/img/guides/<pose>.png (bone-white silhouettes).
// usage: node tools/extract-guides.mjs <OpenMortal/data/characters>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readDatafile } from '../public/js/omformat.js';
import { encodePNG } from '../public/js/png.js';

const dir = process.argv[2];
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img', 'guides');
fs.mkdirSync(OUT, { recursive: true });
const NAME = 'Zoli';
const POSES = { stance: ['stand', 0.0], walk: ['walk', 0.5], punch: ['highpunch', 0.6], kick: ['highkick', 0.6], crouch: ['kneeling', 1.0],
  lowattack: ['kneelingpunch', 0.7], block: ['block', 1.0], ouch: ['highpunched', 0.6], knockdown: ['falling', 0.45], victory: ['won', 0.6], special: ['grenade', 0.6] };
const pl = fs.readFileSync(path.join(dir, `${NAME}.pl`), 'latin1');
const txt = fs.readFileSync(path.join(dir, `${NAME}.dat.txt`), 'latin1').trim().split('\n');
const [, px, py] = /LoadFrames\(\s*"[^"]+"\s*,\s*(-?\d+)\s*,\s*(-?\d+)/.exec(pl).map(Number);
const items = [.../CreateFrameLookup\((.*?)\);/s.exec(pl)[1].matchAll(/["'](\w+)["'],\s*(\d+)/g)].map(m => [m[1], +m[2]]);
const starts = {}; let idx = 0; for (const [g, n] of items) { starts[g] = [idx, n]; idx += n; }
const { frames } = readDatafile(fs.readFileSync(path.join(dir, `${NAME}.dat`)));
// common canvas: 360 wide x 330 tall, centred, feet at y=320
const W = 360, H = 330, FY = 320;
for (const [pose, [group, t]] of Object.entries(POSES)) {
  const [s, n] = starts[group]; const i = s + Math.min(n - 1, Math.round(t * (n - 1)));
  const f = frames[i]; const g = k => +new RegExp(`'${k}'=>\\s*(-?\\d+)`).exec(txt[i])[1];
  const ox = Math.round((W - f.w) / 2), oy = g('y') - py - 290 + FY;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    if (!f.px[y * f.w + x]) continue; const X = x + ox, Y = y + oy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    rgba.set([239, 227, 200, 255], (Y * W + X) * 4);
  }
  fs.writeFileSync(path.join(OUT, `${pose}.png`), encodePNG(W, H, rgba, zlib.deflateSync));
}
console.log('guides written:', Object.keys(POSES).join(', '));
