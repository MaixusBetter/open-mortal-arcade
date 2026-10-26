// png.js - minimal PNG encoder (RGBA8 or palette+tRNS). Caller supplies a zlib deflate
// function: Node -> zlib.deflateSync, browser -> deflateAsync() below (CompressionStream).

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf, crc = 0xffffffff) { for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 255] ^ (crc >>> 8); return crc; }

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

function concat(parts) { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }

function header(w, h, colorType) {
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return ihdr;
}
const SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function rawRGBA(w, h, rgba) {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  return raw;
}
function rawIndexed(w, h, px) {
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; raw.set(px.subarray(y * w, (y + 1) * w), y * (w + 1) + 1); }
  return raw;
}

export function encodePNG(w, h, rgba, deflate) {
  return concat([SIG, chunk('IHDR', header(w, h, 6)), chunk('IDAT', deflate(rawRGBA(w, h, rgba))), chunk('IEND', new Uint8Array(0))]);
}

/** Palette PNG. palette = [[r,g,b]...], transparentIndex = index made fully transparent (or -1). */
export function encodeIndexedPNG(w, h, px, palette, transparentIndex, deflate) {
  const plte = new Uint8Array(palette.length * 3); palette.forEach((c, i) => plte.set(c.slice(0, 3), i * 3));
  const parts = [SIG, chunk('IHDR', header(w, h, 3)), chunk('PLTE', plte)];
  if (transparentIndex >= 0) { const t = new Uint8Array(transparentIndex + 1).fill(255); t[transparentIndex] = 0; parts.push(chunk('tRNS', t)); }
  parts.push(chunk('IDAT', deflate(rawIndexed(w, h, px))), chunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

// Browser helpers (async because CompressionStream is async)
export async function deflateAsync(data) {
  const cs = new CompressionStream('deflate');
  const buf = await new Response(new Blob([data]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}
export async function encodePNGAsync(w, h, rgba) {
  const z = await deflateAsync(rawRGBA(w, h, rgba));
  return concat([SIG, chunk('IHDR', header(w, h, 6)), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))]);
}
export async function encodeIndexedPNGAsync(w, h, px, palette, transparentIndex) {
  const z = await deflateAsync(rawIndexed(w, h, px));
  return encodeIndexedPNG(w, h, px, palette, transparentIndex, () => z);
}
