// borrow.js - "mix and match": pull one move out of another fighter's real .dat file.
import { readDatafile, FEET_Y } from '../omformat.js';
import { readZipAsync } from '../zip.js';
import { api } from '../ui.js';

export async function listBorrowable() {
  const [stock, arcade] = await Promise.all([api('api/stock').catch(() => []), api('api/fighters').catch(() => [])]);
  return [
    ...stock.map(s => ({ ...s, stock: true, icon: `api/stock/${s.codename}/${s.codename}.icon.png` })),
    ...arcade.map(a => ({ name: a.name, codename: a.codename, stock: false, icon: `api/fighters/${a.codename}/icon.png` })),
  ];
}

async function fighterFiles(f) {
  if (f.stock) {
    const get = async n => new Uint8Array(await (await fetch(`api/stock/${f.codename}/${n}`)).arrayBuffer());
    const [pl, txt, dat] = await Promise.all([get(`${f.codename}.pl`), get(`${f.codename}.dat.txt`), get(`${f.codename}.dat`)]);
    return { pl, txt, dat };
  }
  const zip = await readZipAsync(new Uint8Array(await (await fetch(`api/fighters/${f.codename}/pack.zip`)).arrayBuffer()));
  const find = ext => zip[Object.keys(zip).find(n => n.endsWith(`${f.codename}${ext}`))];
  return { pl: find('.pl'), txt: find('.dat.txt'), dat: find('.dat') };
}

const latin1 = new TextDecoder('latin1');

/** Returns { w, h, frames: ImageData[], anchor } for one animation group of a fighter. */
export async function borrowMove(f, group) {
  const files = await fighterFiles(f);
  const pl = latin1.decode(files.pl), txt = latin1.decode(files.txt).trim().split('\n');
  const piv = /LoadFrames\(\s*"[^"]+"\s*,\s*(-?\d+)\s*,\s*(-?\d+)/.exec(pl);
  const px = piv ? +piv[1] : 0, py = piv ? +piv[2] : 0;
  const body = /CreateFrameLookup\((.*?)\);/s.exec(pl);
  if (!body) throw new Error(`${f.name}'s script uses a layout this tool can't read.`);
  const items = [...body[1].matchAll(/["'](\w+)["'],\s*(\d+)/g)].map(m => [m[1], +m[2]]);
  let idx = 0, start = -1, count = 0;
  for (const [g, n] of items) { if (g === group) { start = idx; count = n; break; } idx += n; }
  if (start < 0 && group === 'grenade') return borrowMove(f, 'highpunch');
  if (start < 0) throw new Error(`${f.name} has no "${group}" animation.`);
  const { palette, frames } = readDatafile(files.dat);
  const sel = [];
  for (let i = start; i < start + count; i++) {
    const g = k => +new RegExp(`'${k}'=>\\s*(-?\\d+)`).exec(txt[i])[1];
    sel.push({ f: frames[i], x: g('x') - px, y: g('y') - py });
  }
  const ext = Math.max(...sel.map(s => Math.max(Math.abs(s.x), Math.abs(s.x + s.f.w))));
  const minY = Math.min(...sel.map(s => s.y)), maxY = Math.max(...sel.map(s => s.y + s.f.h));
  const W = Math.ceil(ext * 2 + 20), oy = 16 - minY, H = Math.ceil(Math.max(maxY, FEET_Y) + oy + 12);
  const ax = Math.round(W / 2);
  const out = sel.map(s => {
    const im = new ImageData(W, H);
    for (let y = 0; y < s.f.h; y++) for (let x = 0; x < s.f.w; x++) {
      const c = s.f.px[y * s.f.w + x]; if (!c) continue;
      const X = x + s.x + ax, Y = y + s.y + oy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const o = (Y * W + X) * 4, p = palette[c]; im.data[o] = p[0]; im.data[o + 1] = p[1]; im.data[o + 2] = p[2]; im.data[o + 3] = 255;
    }
    return im;
  });
  return { w: W, h: H, frames: out, anchor: { x: ax, y: FEET_Y + oy } };
}
