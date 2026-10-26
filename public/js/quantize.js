// quantize.js - palette building for OpenMortal's 63-colour fighter palettes.
// k-means++ in RGB on a pixel sample, with optional fixed colours (paint-tool colours keep their exact values).

function dist2(a, r, g, b) { const dr = a[0] - r, dg = a[1] - g, db = a[2] - b; return dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11; }

/**
 * samples: Uint8Array of packed rgb triplets
 * k: total palette size wanted (fixed colours count towards it)
 * fixed: [[r,g,b], ...] colours that must appear exactly
 */
export function buildPalette(samples, k, fixed = [], { iterations = 10, seed = 12345 } = {}) {
  const n = Math.floor(samples.length / 3);
  const free = Math.max(0, k - fixed.length);
  if (n === 0 || free === 0) return fixed.slice(0, k).map(c => c.slice());
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  // subsample to at most 40k pixels
  const step = Math.max(1, Math.floor(n / 40000));
  const pts = []; for (let i = 0; i < n; i += step) pts.push([samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2]]);
  // k-means++ seeding
  const cents = [pts[Math.floor(rnd() * pts.length)].slice()];
  const d = new Float64Array(pts.length).fill(Infinity);
  while (cents.length < Math.min(free, pts.length)) {
    const c = cents[cents.length - 1]; let sum = 0;
    for (let i = 0; i < pts.length; i++) { const v = dist2(c, pts[i][0], pts[i][1], pts[i][2]); if (v < d[i]) d[i] = v; sum += d[i]; }
    if (sum === 0) break;
    let r = rnd() * sum, i = 0; for (; i < pts.length - 1; i++) { r -= d[i]; if (r <= 0) break; }
    cents.push(pts[i].slice());
  }
  const all = () => fixed.concat(cents);
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < iterations; it++) {
    const pal = all(); const acc = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bd = Infinity; const p = pts[i];
      for (let j = 0; j < pal.length; j++) { const v = dist2(pal[j], p[0], p[1], p[2]); if (v < bd) { bd = v; best = j; } }
      assign[i] = best; const cj = best - fixed.length;
      if (cj >= 0) { const a = acc[cj]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++; }
    }
    let moved = 0;
    for (let j = 0; j < cents.length; j++) {
      const a = acc[j];
      if (a[3] === 0) { cents[j] = pts[Math.floor(rnd() * pts.length)].slice(); moved++; continue; }
      const nc = [Math.round(a[0] / a[3]), Math.round(a[1] / a[3]), Math.round(a[2] / a[3])];
      if (nc[0] !== cents[j][0] || nc[1] !== cents[j][1] || nc[2] !== cents[j][2]) moved++;
      cents[j] = nc;
    }
    if (!moved) break;
  }
  return all().map(c => c.map(v => Math.max(0, Math.min(255, v))));
}

/** Returns a function rgb -> palette index (index into `palette`), cached at 5 bits per channel. */
export function makeMapper(palette) {
  const cache = new Int16Array(32768).fill(-1);
  return (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let v = cache[key];
    if (v >= 0) return v;
    let best = 0, bd = Infinity;
    for (let j = 0; j < palette.length; j++) { const d = dist2(palette[j], r, g, b); if (d < bd) { bd = d; best = j; } }
    cache[key] = best; return best;
  };
}
