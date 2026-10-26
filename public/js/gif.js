// gif.js - animated GIF encoder (indexed, transparent index 0) and a small decoder for imports.

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------
function lzwEncode(indices, minCodeSize) {
  const out = []; let cur = 0, curBits = 0;
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1;
  let dict = new Map();
  const emit = code => { cur |= code << curBits; curBits += codeSize; while (curBits >= 8) { out.push(cur & 255); cur >>>= 8; curBits -= 8; } };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << codeSize) && codeSize < 12) codeSize++; }
    else { emit(clear); dict = new Map(); codeSize = minCodeSize + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (curBits > 0) out.push(cur & 255);
  return out;
}

/**
 * frames: [{ px: Uint8Array (indices, 0 = transparent), delay: centiseconds }]
 * palette: [[r,g,b] x up to 256], index 0 is transparent
 */
export function encodeGIF(w, h, frames, palette, { loop = 0 } = {}) {
  const bytes = [];
  const u16 = v => bytes.push(v & 255, (v >> 8) & 255);
  const str = s => { for (const c of s) bytes.push(c.charCodeAt(0)); };
  let bits = 1; while ((1 << bits) < palette.length) bits++;
  const size = 1 << bits;
  str('GIF89a'); u16(w); u16(h);
  bytes.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let i = 0; i < size; i++) { const c = palette[i] || [0, 0, 0]; bytes.push(c[0], c[1], c[2]); }
  str('!\xFF\x0BNETSCAPE2.0'); bytes.push(3, 1); u16(loop); bytes.push(0);
  const minCode = Math.max(2, bits);
  for (const f of frames) {
    bytes.push(0x21, 0xF9, 4, (2 << 2) | 1); u16(f.delay || 8); bytes.push(0, 0);   // dispose to background, transparent idx 0
    bytes.push(0x2C); u16(0); u16(0); u16(w); u16(h); bytes.push(0);
    bytes.push(minCode);
    const data = lzwEncode(f.px, minCode);
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); bytes.push(n); for (let k = 0; k < n; k++) bytes.push(data[i + k]); }
    bytes.push(0);
  }
  bytes.push(0x3B);
  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// Decoder -> [{ rgba: Uint8ClampedArray, delay (ms) }], w, h
// ---------------------------------------------------------------------------
export function decodeGIF(buf) {
  const u = new Uint8Array(buf); let p = 6;
  const r16 = () => { const v = u[p] | (u[p + 1] << 8); p += 2; return v; };
  if (String.fromCharCode(...u.subarray(0, 3)) !== 'GIF') throw new Error('Not a GIF');
  const W = r16(), H = r16(); const flags = u[p++]; const bg = u[p++]; p++;
  void bg;
  let gct = null;
  if (flags & 0x80) { const n = 2 << (flags & 7); gct = u.subarray(p, p + n * 3); p += n * 3; }
  const canvas = new Uint8ClampedArray(W * H * 4);
  const frames = []; let gce = { delay: 100, transp: -1, dispose: 0 };
  while (p < u.length) {
    const b = u[p++];
    if (b === 0x3B) break;
    if (b === 0x21) {
      const label = u[p++];
      if (label === 0xF9) { p++; const f = u[p++]; const d = r16(); const t = u[p++]; p++; gce = { delay: Math.max(20, d * 10), transp: f & 1 ? t : -1, dispose: (f >> 2) & 7 }; }
      else { while (u[p]) p += u[p] + 1; p++; }
    } else if (b === 0x2C) {
      const fx = r16(), fy = r16(), fw = r16(), fh = r16(); const ff = u[p++];
      let ct = gct; if (ff & 0x80) { const n = 2 << (ff & 7); ct = u.subarray(p, p + n * 3); p += n * 3; }
      const interlaced = !!(ff & 0x40);
      const minCode = u[p++]; const chunks = [];
      while (u[p]) { chunks.push(u.subarray(p + 1, p + 1 + u[p])); p += u[p] + 1; } p++;
      const data = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0)); let o = 0; for (const c of chunks) { data.set(c, o); o += c.length; }
      const idx = lzwDecode(data, minCode, fw * fh);
      const before = gce.dispose === 3 ? canvas.slice() : null;
      const rows = interlaced ? interlaceRows(fh) : null;
      for (let i = 0; i < fw * fh; i++) {
        const c = idx[i]; if (c === gce.transp) continue;
        const y = rows ? rows[Math.floor(i / fw)] : Math.floor(i / fw), x = i % fw;
        const X = fx + x, Y = fy + y; if (X >= W || Y >= H) continue;
        const q = (Y * W + X) * 4; canvas[q] = ct[c * 3]; canvas[q + 1] = ct[c * 3 + 1]; canvas[q + 2] = ct[c * 3 + 2]; canvas[q + 3] = 255;
      }
      frames.push({ rgba: canvas.slice(), delay: gce.delay });
      if (gce.dispose === 2) for (let y = fy; y < fy + fh && y < H; y++) canvas.fill(0, (y * W + fx) * 4, (y * W + Math.min(W, fx + fw)) * 4);
      else if (before) canvas.set(before);
      gce = { delay: 100, transp: -1, dispose: 0 };
    } else break;
  }
  return { w: W, h: H, frames };
}

function interlaceRows(h) {
  const rows = []; for (const [s, st] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = s; y < h; y += st) rows.push(y);
  return rows;
}

function lzwDecode(data, minCode, count) {
  const out = new Uint8Array(count); let op = 0;
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, mask = (1 << size) - 1, next = eoi + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let bits = 0, acc = 0, prev = -1, first = 0, i = 0;
  while (op < count) {
    while (bits < size) { if (i >= data.length) return out; acc |= data[i++] << bits; bits += 8; }
    let code = acc & mask; acc >>>= size; bits -= size;
    if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    if (prev === -1) { out[op++] = suffix[code]; prev = code; first = code; continue; }
    let sp = 0, c = code;
    if (code >= next) { stack[sp++] = first; c = prev; }
    while (c >= clear) { stack[sp++] = suffix[c]; c = prefix[c]; }
    stack[sp++] = suffix[c]; first = c;
    while (sp && op < count) out[op++] = stack[--sp];
    if (next < 4096) { prefix[next] = prev; suffix[next] = first; next++; if ((next & mask) === 0 && next < 4096) { size++; mask = (1 << size) - 1; } }
    prev = code;
  }
  return out;
}
