// selfcert.mjs - makes a self-signed TLS certificate with Node's own crypto, so --https works
// on any machine without openssl. Browsers show a warning once per device, which is expected
// for a certificate nobody vouches for; after that, phones get camera access on the LAN.
import crypto from 'node:crypto';

// --- minimal DER encoder -------------------------------------------------------------------
function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const ctx = (n, body, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body);
const nul = () => Buffer.from([0x05, 0x00]);
const bool = v => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const octets = b => tlv(0x04, b);
const utf8 = s => tlv(0x0c, Buffer.from(s, 'utf8'));
const bits = b => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
function int(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
function oid(s) {
  const p = s.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const enc = [v & 0x7f];
    for (let x = v >>> 7; x > 0; x >>>= 7) enc.unshift(0x80 | (x & 0x7f));
    out.push(...enc);
  }
  return tlv(0x06, Buffer.from(out));
}
function utcTime(d) {
  const p = n => String(n).padStart(2, '0');
  return tlv(0x17, Buffer.from(`${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`));
}
function ipBytes(ip) {
  if (ip.includes(':')) {   // IPv6, with :: expansion
    const [head, tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
    const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
    return Buffer.from(groups.flatMap(g => { const v = parseInt(g || '0', 16); return [v >> 8, v & 0xff]; }));
  }
  return Buffer.from(ip.split('.').map(Number));
}

/**
 * makeSelfSignedCert({ names: ['localhost'], ips: ['127.0.0.1', '192.168.1.20'], days: 365 })
 * -> { key: PEM string, cert: PEM string }
 */
export function makeSelfSignedCert({ names = ['localhost'], ips = ['127.0.0.1'], days = 365, commonName = 'Mortal Arcade' } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sha256WithRSA = seq(oid('1.2.840.113549.1.1.11'), nul());
  const name = seq(set(seq(oid('2.5.4.3'), utf8(commonName))));
  const now = new Date(Date.now() - 60 * 60 * 1000);           // an hour of slack for clock skew
  const until = new Date(now.getTime() + days * 86400000);
  const altNames = seq(
    ...names.map(n => ctx(2, Buffer.from(n, 'ascii'), false)),
    ...ips.map(ip => ctx(7, ipBytes(ip), false)),
  );
  const extensions = seq(
    seq(oid('2.5.29.19'), bool(true), octets(seq())),                                   // basicConstraints: not a CA
    seq(oid('2.5.29.15'), bool(true), octets(tlv(0x03, Buffer.from([0x05, 0xa0])))),   // keyUsage: digitalSignature, keyEncipherment
    seq(oid('2.5.29.37'), octets(seq(oid('1.3.6.1.5.5.7.3.1')))),                       // extKeyUsage: serverAuth
    seq(oid('2.5.29.17'), octets(altNames)),                                              // subjectAltName
  );
  const tbs = seq(
    ctx(0, int(Buffer.from([2]))),                                  // v3
    int(crypto.randomBytes(16)),
    sha256WithRSA, name,
    seq(utcTime(now), utcTime(until)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    ctx(3, extensions),
  );
  const signature = crypto.sign('sha256', tbs, privateKey);
  const der = seq(tbs, sha256WithRSA, bits(signature));
  const pem = (label, b) => `-----BEGIN ${label}-----\n${b.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem('CERTIFICATE', der) };
}
