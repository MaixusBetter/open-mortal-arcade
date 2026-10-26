// Round-trip test: decode a stock fighter, rebuild it with Mortal Arcade's exporter
// under a new codename/ID, and drop it into a game folder for the real engine to load.
// usage: node tools/test-roundtrip.mjs <stockCharactersDir> <Codename> <outCharactersDir> <NewCodename> <newId>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readDatafile } from '../public/js/omformat.js';
import { assembleFighter, makePortraits, autoBoxes } from '../public/js/fighterbuild.js';
import { encodePNG } from '../public/js/png.js';

const [srcDir, name, outDir, newName, newId] = process.argv.slice(2);
const { palette, frames } = readDatafile(fs.readFileSync(path.join(srcDir, `${name}.dat`)));
const pl = fs.readFileSync(path.join(srcDir, `${name}.pl`), 'latin1');
const txt = fs.readFileSync(path.join(srcDir, `${name}.dat.txt`), 'latin1').trim().split('\n');
const [, px, py] = /LoadFrames\(\s*"[^"]+"\s*,\s*(-?\d+)\s*,\s*(-?\d+)/.exec(pl).map(Number);
const lookupSrc = /CreateFrameLookup\((.*?)\);/s.exec(pl)[1];
const items = [...lookupSrc.matchAll(/["'](\w+)["'],\s*(\d+)/g)].map(m => [m[1], +m[2]]);

const toFrame = i => {
  const f = frames[i]; const rgba = new Uint8ClampedArray(f.w * f.h * 4);
  for (let k = 0; k < f.px.length; k++) { const c = f.px[k]; if (!c) continue; const p = palette[c]; rgba.set([p[0], p[1], p[2], 255], k * 4); }
  const g = k => +new RegExp(`'${k}'=>\\s*(-?\\d+)`).exec(txt[i])[1];
  return { w: f.w, h: f.h, rgba, x: g('x') - px, y: g('y') - py };
};

const groups = {}; let idx = 0;
for (const [g, n] of items) { const list = []; for (let k = 0; k < n; k++) list.push(toFrame(idx + k)); groups[g] = list; idx += n; }
// map stock-only groups onto ours
groups.special = groups.specpunch || groups.cranekick || groups.spin;
const res = assembleFighter({
  codename: newName, id: +newId, gender: 2,
  stats: { name: `${name} Remix`, team: 'Mortal Arcade', style: 'Round-trip-fu', story: `Rebuilt from ${name}.dat by the Mortal Arcade exporter to prove the file format.` },
  groups, special: { combo: 'hpunchFF', hit: 'Uppercut', label: 'Remix punch' },
});
fs.mkdirSync(outDir, { recursive: true });
for (const [fn, data] of Object.entries(res.files)) fs.writeFileSync(path.join(outDir, fn), data);
const stand = autoBoxes({ ...groups.stand[0] });
const { icon, full } = makePortraits(stand);
fs.writeFileSync(path.join(outDir, `${res.codename}.icon.png`), encodePNG(icon.w, icon.h, icon.rgba, zlib.deflateSync));
fs.writeFileSync(path.join(outDir, `${res.codename}.full.png`), encodePNG(full.w, full.h, full.rgba, zlib.deflateSync));
console.log('wrote', Object.keys(res.files), 'frames', res.frames.length, 'dat bytes', res.files[`${res.codename}.dat`].length);
console.log('counts', JSON.stringify(res.counts));
