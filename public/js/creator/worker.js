// worker.js - builds the fighter off the main thread: normalize -> palette -> RLE .dat -> scripts -> portraits.
import { normalizeFrame, assembleFighter, makePortraits, autoBoxes } from '../fighterbuild.js';
import { GROUP_BY_ID } from '../omformat.js';
import { encodePNGAsync } from '../png.js';

self.onmessage = async e => {
  try {
    const { unique, groups, proj, spec, script } = e.data;
    const progress = (text, value) => self.postMessage({ type: 'progress', text, value });
    progress('Placing frames on the floor...', 0);
    const norm = new Map(); let k = 0;
    for (const [key, u] of unique) {
      k++;
      if (!u) { norm.set(key, null); continue; }
      norm.set(key, normalizeFrame({ w: u.w, h: u.h, rgba: u.rgba }, u.t));
      if (k % 10 === 0) progress('Placing frames on the floor...', k / unique.length * 0.5);
    }
    const g = {};
    for (const [gid, refs] of Object.entries(groups)) g[gid] = refs.map(r => norm.get(`${r.clip}:${r.index}`)).filter(Boolean);
    if (proj && proj.length && spec.projectile) {
      // crop all projectile frames to one shared box so the animation stays aligned
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (const f of proj) for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (f.rgba[(y * f.w + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const W = x1 - x0 + 1, H = y1 - y0 + 1;
      g.shotdoodad = proj.map(f => {
        const out = new Uint8ClampedArray(W * H * 4);
        for (let y = 0; y < H; y++) out.set(f.rgba.subarray(((y0 + y) * f.w + x0) * 4, ((y0 + y) * f.w + x0 + W) * 4), y * W * 4);
        return { w: W, h: H, rgba: out, x: 0, y: 0 };
      });
      spec.projectile.w = W; spec.projectile.h = H;
    }
    progress('Choosing 63 colours and packing sprites...', 0.6);
    const res = assembleFighter({ ...spec, groups: g });
    if (script) {
      // Hands-on: the person's own script, with the data size kept honest
      res.files[`${res.codename}.pl`] = script.replace(/('DATASIZE'\s*=>\s*)\d+/, `$1${res.files[`${res.codename}.dat`].length}`);
    }
    progress('Making portraits...', 0.9);
    const stance = g.stand && g.stand[0] ? autoBoxes({ ...g.stand[0] }) : res.frames[0];
    const { icon, full } = makePortraits(stance);
    res.files[`${res.codename}.icon.png`] = await encodePNGAsync(icon.w, icon.h, icon.rgba);
    res.files[`${res.codename}.full.png`] = await encodePNGAsync(full.w, full.h, full.rgba);
    const timing = {};
    for (const gid of Object.keys(res.counts)) timing[gid] = (spec.timing && spec.timing[gid]) || (GROUP_BY_ID[gid] && GROUP_BY_ID[gid].del) || 5;
    self.postMessage({ type: 'done', result: {
      codename: res.codename, files: res.files, counts: res.counts, palette: res.palette, timing,
      frames: res.frames.map(f => ({ w: f.w, h: f.h, x: f.x, y: f.y, rgba: f.rgba, head: f.head, body: f.body, legs: f.legs, hit: f.hit || null, group: f.group, n: f.n })),
    } });
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message || String(err) });
  }
};
