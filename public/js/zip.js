// zip.mjs - small ZIP reader/writer (store + deflate) with no dependencies.
// Works in Node (pass zlib) and in browsers (store only, or async deflate-raw).

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

const enc = new TextEncoder();
const toBytes = d => (typeof d === 'string' ? enc.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d));

function dosTime(d = new Date()) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * entries: [{ name, data: Uint8Array|string }]
 * deflateRaw: optional (Uint8Array) => Uint8Array ; when given, entries are deflated if that helps.
 */
export function writeZip(entries, deflateRaw = null) {
  const { time, date } = dosTime();
  const locals = []; const centrals = []; let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name.replace(/\\/g, '/'));
    const raw = toBytes(e.data);
    const crc = crc32(raw);
    let method = 0, body = raw;
    if (deflateRaw && raw.length > 64 && !e.store) {
      const z = deflateRaw(raw);
      if (z.length < raw.length) { method = 8; body = z; }
    }
    const lh = new Uint8Array(30 + name.length); const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, method, true);
    lv.setUint16(10, time, true); lv.setUint16(12, date, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, method, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true); cv.setUint16(28, name.length, true); cv.setUint32(38, name[name.length - 1] === 47 ? 0x10 : 0, true);
    cv.setUint32(42, offset, true); ch.set(name, 46);
    locals.push(lh, body); centrals.push(ch);
    offset += lh.length + body.length;
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let k = 0;
  for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}

/** Returns [{ name, method, data (compressed), size, crc }] ; call inflate on method 8 entries. */
export function listZip(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let eocd = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Bad central directory');
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(lo + 26, true), lxlen = dv.getUint16(lo + 28, true);
    const start = lo + 30 + lnlen + lxlen;
    out.push({ name, method, data: u.subarray(start, start + csize), size, crc });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export function readZipSync(bytes, inflateRaw) {
  const files = {};
  for (const e of listZip(bytes)) {
    if (e.name.endsWith('/')) continue;
    files[e.name] = e.method === 0 ? e.data.slice() : e.method === 8 ? new Uint8Array(inflateRaw(e.data)) : null;
    if (!files[e.name]) throw new Error(`Unsupported compression in ${e.name}`);
  }
  return files;
}

// Browser async variants
export async function inflateRawAsync(data) {
  const ds = new DecompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
}
export async function readZipAsync(bytes) {
  const files = {};
  for (const e of listZip(bytes)) {
    if (e.name.endsWith('/')) continue;
    files[e.name] = e.method === 0 ? e.data.slice() : await inflateRawAsync(e.data);
  }
  return files;
}
