#!/usr/bin/env node
// Mortal Arcade server: one command, no npm install.
//   node server/server.mjs            -> http://localhost:8080 (and your LAN address)
//   node server/server.mjs --https    -> also https://<lan-ip>:8443 for phone cameras (certificate made here, no openssl)
//   node server/server.mjs --open     -> also opens the title screen in your browser
//   PORT=9000 node server/server.mjs  -> a fixed port (otherwise the next free one after 8080 is used)
// Most people start it with "Start Arcade" instead, which also fetches what the game needs.
// Serves the web app, the Boxedwine runtime and OpenMortal, relays phone/laptop controller
// input to the big screen over WebSockets, and stores the fighters and stages people make.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeZip, readZipSync, listZip } from '../public/js/zip.js';
import { readPackInfo, renameFighterPack, buildIni, buildRosterPl, sanitizeCodename } from '../public/js/omformat.js';
import { makeSelfSignedCert } from './selfcert.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.MA_DATA || path.join(ROOT, 'data');
const FIGHTERS = path.join(DATA, 'fighters');
const STAGES = path.join(DATA, 'stages');
const PORT = +(process.env.PORT || 8080);
const HTTPS_PORT = +(process.env.HTTPS_PORT || 8443);
const WANT_HTTPS = process.argv.includes('--https');
const WANT_OPEN = process.argv.includes('--open');
const FS_ZIPS = ['TinyCore15Wine11.0-web.zip', 'TinyCore15Wine11.0.zip'];   // Boxedwine's Wine file system, either variant
let activePort = PORT, activeHttpsPort = null;   // the ports actually in use
// Where OpenMortal lives inside the emulated Windows (Boxedwine's default Wine prefix)
const GAME_DIR = 'home/username/.wine/drive_c/OpenMortal';
const MAX_UPLOAD = 64 * 1024 * 1024;
const MAX_CUSTOM_FIGHTERS = 12;  // 18 stock + 12 = a full 5x6 select grid (tested in the real game)

for (const d of [FIGHTERS, STAGES]) fs.mkdirSync(d, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.zip': 'application/zip', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.data': 'application/octet-stream', '.tflite': 'application/octet-stream', '.binarypb': 'application/octet-stream',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

function isolationHeaders(res) {
  // Cross-origin isolation lets the Boxedwine runtime use SharedArrayBuffer (threads, low-latency audio).
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function send(res, status, body, type = 'application/json') {
  isolationHeaders(res);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body));
}

// LAN addresses, most likely Wi-Fi/Ethernet first: virtual adapters (WSL, Hyper-V, VirtualBox,
// VMware, Docker, VPNs) come last so the join QR code points somewhere phones can reach.
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      let score = 0;
      if (/vethernet|wsl|hyper-v|virtualbox|vmware|vbox|docker|br-|veth|tailscale|zerotier|vpn|utun|tun|tap/i.test(name)) score += 10;
      if (a.address.startsWith('172.')) score += 2;
      if (/wi-?fi|wlan|wireless|ethernet|^en\d|^eth|^wl/i.test(name)) score -= 1;
      out.push({ address: a.address, score });
    }
  }
  return out.sort((x, y) => x.score - y.score).map(x => x.address);
}

async function readBody(req, limit = MAX_UPLOAD) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('Upload too large'), { status: 413 }); chunks.push(c); }
  return new Uint8Array(Buffer.concat(chunks));
}

// ---------------------------------------------------------------------------
// Static files (with Range support for big zips)
// ---------------------------------------------------------------------------
async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  let st;
  try { st = await fsp.stat(file); } catch {
    // short addresses people type from the big screen: /pad, /host, /create ... -> the page
    if (!path.extname(file) && fs.existsSync(file + '.html')) {
      res.writeHead(302, { Location: rel + '.html' + new URL(req.url, 'http://x').search }); return res.end();
    }
    return send(res, 404, { error: 'Not found', path: rel });
  }
  if (st.isDirectory()) return serveStatic(req, res, rel + '/');
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  isolationHeaders(res);
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Last-Modified': st.mtime.toUTCString(),
    'Cache-Control': /\.(html|js|css)$/.test(file) ? 'no-cache' : 'public, max-age=3600' };
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? +range[1] : st.size - +range[2];
    const end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// Fighters & stages storage
// ---------------------------------------------------------------------------
const inflateRaw = d => zlib.inflateRawSync(d);
const deflateRaw = d => zlib.deflateRawSync(d, { level: 6 });

async function listFighters() {
  const out = [];
  for (const f of await fsp.readdir(FIGHTERS)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(await fsp.readFile(path.join(FIGHTERS, f), 'utf8'))); } catch {}
  }
  return out.sort((a, b) => b.created - a.created);
}

async function nextFighterId() {
  const used = new Set((await listFighters()).map(f => f.id));
  let id = 200; while (used.has(id)) id++;
  return id;
}

async function saveFighter(zipBytes) {
  const files = readZipSync(zipBytes, inflateRaw);
  const flat = {};
  for (const [n, d] of Object.entries(files)) flat[n.split('/').pop()] = d;
  const info = readPackInfo(flat);
  if (!info) throw Object.assign(new Error('That zip has no fighter script (.pl).'), { status: 400 });
  // unique codename + id
  const existing = new Set((await listFighters()).map(f => f.codename.toLowerCase()));
  const stock = ['agent', 'ambrus', 'bence', 'cumi', 'dani', 'descant', 'elf', 'grizli', 'jacint', 'jozsi', 'judy', 'kinga', 'macy', 'misi', 'mrsmith', 'sirpi', 'sleepy', 'surba', 'upi', 'ulmar', 'zoli', 'staff'];
  let base = sanitizeCodename(info.codename), name = base, n = 2;
  while (existing.has(name.toLowerCase()) || stock.includes(name.toLowerCase())) name = (base.slice(0, 13) + n++);
  const id = await nextFighterId();
  const renamed = renameFighterPack(flat, name, id);
  for (const need of ['.pl', '.dat', '.dat.txt']) if (!renamed.files[name + need]) throw Object.assign(new Error(`Fighter pack is missing ${name}${need}`), { status: 400 });
  const entries = Object.entries(renamed.files).map(([n2, d]) => ({ name: n2, data: d }));
  const packZip = writeZip(entries, deflateRaw);
  await fsp.writeFile(path.join(FIGHTERS, `${name}.zip`), packZip);
  const icon = renamed.files[`${name}.icon.png`];
  if (icon) await fsp.writeFile(path.join(FIGHTERS, `${name}.icon.png`), icon);
  const full = renamed.files[`${name}.full.png`];
  if (full) await fsp.writeFile(path.join(FIGHTERS, `${name}.full.png`), full);
  const meta = { ...readPackInfo(renamed.files), codename: name, id, created: Date.now(), size: packZip.length,
    renamedFrom: name !== info.codename ? info.codename : undefined };
  await fsp.writeFile(path.join(FIGHTERS, `${name}.json`), JSON.stringify(meta, null, 1));
  return meta;
}

async function listStages() {
  const out = [];
  for (const f of await fsp.readdir(STAGES)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(await fsp.readFile(path.join(STAGES, f), 'utf8'))); } catch {}
  }
  return out.sort((a, b) => b.created - a.created);
}

async function saveStage(zipBytes) {
  const files = readZipSync(zipBytes, inflateRaw);
  const metaFile = files['stage.json'];
  const meta = metaFile ? JSON.parse(new TextDecoder().decode(metaFile)) : {};
  const id = crypto.randomBytes(4).toString('hex');
  // a stage is either one 1920x480 panorama (stage.jpg) or parallax layers (stage.desc + pngs)
  if (!files['stage.jpg'] && !files['stage.desc']) throw Object.assign(new Error('A stage zip needs stage.jpg or stage.desc'), { status: 400 });
  await fsp.writeFile(path.join(STAGES, `${id}.zip`), writeZip(Object.entries(files).map(([name, data]) => ({ name, data })), deflateRaw));
  if (files['preview.png']) await fsp.writeFile(path.join(STAGES, `${id}.preview.png`), files['preview.png']);
  const out = { id, name: String(meta.name || 'Untitled stage').slice(0, 40), author: String(meta.author || '').slice(0, 40), created: Date.now() };
  await fsp.writeFile(path.join(STAGES, `${id}.json`), JSON.stringify(out, null, 1));
  return out;
}

// ---------------------------------------------------------------------------
// Stock fighters, read straight out of the real game zip (for "borrow a move")
// ---------------------------------------------------------------------------
let gameIndex = null;
async function gameZip() {
  const zp = path.join(PUBLIC, 'game', 'openmortal.zip');
  if (!fs.existsSync(zp)) return null;
  const st = fs.statSync(zp);
  if (!gameIndex || gameIndex.mtime !== st.mtimeMs) {
    const bytes = new Uint8Array(await fsp.readFile(zp));
    const entries = new Map(listZip(bytes).map(e => [e.name.replace(/^.*?OpenMortal\//, ''), e]));
    gameIndex = { mtime: st.mtimeMs, entries };
  }
  return gameIndex;
}
async function stockFile(rel) {
  const g = await gameZip(); if (!g) return null;
  const e = g.entries.get(rel); if (!e) return null;
  return e.method === 8 ? zlib.inflateRawSync(e.data) : e.data;
}
async function stockFighters() {
  const g = await gameZip(); if (!g) return [];
  const out = [];
  for (const name of g.entries.keys()) {
    const m = /^data\/characters\/([A-Za-z]+)\.pl$/.exec(name); if (!m) continue;
    const pl = new TextDecoder('latin1').decode(await stockFile(name));
    if (!/CreateFrameLookup/.test(pl) || !g.entries.has(`data/characters/${m[1]}.icon.png`)) continue;
    const nameMatch = /'NAME'\s*=>\s*'([^']*)'/.exec(pl);
    out.push({ codename: m[1], name: nameMatch ? nameMatch[1] : m[1] });
  }
  // official fighters keep their names in FighterStats.pl
  const stats = new TextDecoder('latin1').decode(await stockFile('bin/FighterStats.pl') || new Uint8Array());
  for (const f of out) {
    const block = new RegExp(`'CODENAME'\\s*=>\\s*'${f.codename}',\\s*'NAME'\\s*=>\\s*'([^']*)'`).exec(stats);
    if (block) f.name = block[1];
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Rosters -> overlay zip injected over the stock game inside the emulator
// ---------------------------------------------------------------------------
const rosters = new Map();   // id -> { fighters, stages, settings }

// custom stages picked for a roster, oldest submission first
async function orderedStages(ids) {
  const wanted = new Set(ids.map(id => String(id).replace(/[^a-f0-9]/g, '')));
  return (await listStages()).filter(st => wanted.has(st.id) && fs.existsSync(path.join(STAGES, `${st.id}.zip`)))
    .sort((a, b) => (a.created || 0) - (b.created || 0));
}

// the stock stages in the game's order, each as .desc text (a panorama .jpg becomes one layer)
async function stockLevels() {
  const g = await gameZip(); if (!g) return [];
  const found = new Map();
  for (const name of g.entries.keys()) {
    const m = /^data\/gfx\/level(\d+)\.(jpg|desc)$/.exec(name); if (!m) continue;
    const n = +m[1];
    if (m[2] === 'desc') found.set(n, new TextDecoder('latin1').decode(await stockFile(name)));
    else if (!found.has(n)) found.set(n, `1\nlevel${n}.jpg\n0 0 1.0\n`);
  }
  return [...found.keys()].sort((a, b) => a - b).map(n => ({ n, desc: found.get(n) }));
}

async function buildOverlay(roster) {
  const entries = [];
  const put = (rel, data) => entries.push({ name: `${GAME_DIR}/${rel}`, data });
  put('bin/OpenMortal.exe.ini', buildIni(roster.settings || {}));
  put('data/characters/zzRoster.pl', buildRosterPl());
  // the computer opponent and the status files the big screen follows (see server/zzArcade.pl)
  const set = roster.settings || {};
  put('data/characters/zzArcade.pl', await fsp.readFile(path.join(HERE, 'zzArcade.pl')));
  const level = ['easy', 'normal', 'hard'].includes(set.cpuLevel) ? set.cpuLevel : 'normal';
  put('arcade/defaults.txt', `p2=${set.p2 === 'cpu' ? 'cpu' : 'human'} level=${level}\n`);
  for (const c of (roster.fighters || []).slice(0, MAX_CUSTOM_FIGHTERS)) {
    const zp = path.join(FIGHTERS, `${sanitizeCodename(c)}.zip`);
    if (!fs.existsSync(zp)) continue;
    const files = readZipSync(await fsp.readFile(zp), inflateRaw);
    for (const [n, d] of Object.entries(files)) put(`data/characters/${n.split('/').pop()}`, d);
  }
  // Stage order. The game shows level1, level2, ... one per match and starts over at level1
  // when the next number is missing. It reads levelN.desc before levelN.jpg, so with custom
  // stages every level is written as a .desc here: the custom stages first, in the order they
  // were submitted, then the stock stages in their usual order.
  const custom = await orderedStages(roster.stages || []);
  if (custom.length) {
    const levels = [];
    for (const [k, st] of custom.entries()) {
      const files = readZipSync(await fsp.readFile(path.join(STAGES, `${st.id}.zip`)), inflateRaw);
      const tag = `arcade${k + 1}`;
      if (files['stage.jpg']) {
        put(`data/gfx/${tag}.jpg`, files['stage.jpg']);
        levels.push(`1\n${tag}.jpg\n0 0 1.0\n`);
      } else {
        let desc = new TextDecoder().decode(files['stage.desc']);
        for (const [n, d] of Object.entries(files)) {
          if (!/^layer\d+\.png$/.test(n)) continue;
          const nn = `${tag}_${n}`;
          put(`data/gfx/${nn}`, d);
          desc = desc.split('\n').map(l => (l.trim() === n ? nn : l)).join('\n');
        }
        levels.push(desc);
      }
    }
    for (const st of await stockLevels()) levels.push(st.desc);
    levels.forEach((desc, i) => put(`data/gfx/level${i + 1}.desc`, desc));
  }
  return writeZip(entries, null);   // stored: Boxedwine reads it straight from memory
}

// ---------------------------------------------------------------------------
// WebSocket (RFC 6455, text frames only) - controller relay
// ---------------------------------------------------------------------------
const rooms = new Map();   // code -> { host, pads: Map(id -> pad), created }
let nextPadId = 1;

function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const ws = { socket, open: true, onmessage: null, onclose: null };
  let buf = Buffer.alloc(0);
  ws.send = obj => {
    if (!ws.open) return;
    const data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
    let header;
    if (data.length < 126) header = Buffer.from([0x81, data.length]);
    else if (data.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
    socket.write(Buffer.concat([header, data]));
  };
  ws.close = () => { if (ws.open) { ws.open = false; try { socket.end(Buffer.from([0x88, 0])); } catch {} ws.onclose && ws.onclose(); } };
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const op = buf[0] & 15, masked = buf[1] & 128; let len = buf[1] & 127, p = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); p = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); p = 10; }
      if (len > 1 << 20) return ws.close();
      const need = p + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(p + (masked ? 4 : 0), need);
      if (masked) { const m = buf.subarray(p, p + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      buf = buf.subarray(need);
      if (op === 8) return ws.close();
      if (op === 9) { socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op === 1 && ws.onmessage) { try { ws.onmessage(JSON.parse(payload.toString('utf8'))); } catch {} }
    }
  });
  socket.on('close', () => ws.close());
  socket.on('error', () => ws.close());
  return ws;
}

function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c; do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function padList(room) { return [...room.pads.values()].map(p => ({ id: p.id, name: p.name, slot: p.slot, device: p.device })); }

function broadcastPads(room) {
  room.host && room.host.send({ t: 'pads', pads: padList(room) });
  for (const p of room.pads.values()) p.ws.send({ t: 'slot', slot: p.slot, id: p.id, players: padList(room).map(x => ({ name: x.name, slot: x.slot })) });
}

function freeSlot(room, pref) {
  const taken = new Set([...room.pads.values()].map(p => p.slot));
  if (pref && pref !== 'auto' && !taken.has(pref)) return pref;
  for (const s of ['p1', 'p2']) if (!taken.has(s)) return s;
  return 'wait';
}

function onWebSocket(ws) {
  let role = null, room = null, pad = null;
  ws.onmessage = msg => {
    if (msg.t === 'host') {
      role = 'host';
      if (msg.code && rooms.has(msg.code) && !rooms.get(msg.code).host) room = rooms.get(msg.code);
      else { const code = roomCode(); room = { code, host: null, pads: new Map(), created: Date.now() }; rooms.set(code, room); }
      room.host = ws;
      ws.send({ t: 'room', code: room.code, lan: lanAddresses(), port: activePort, httpsPort: activeHttpsPort });
      broadcastPads(room);
    } else if (msg.t === 'join') {
      const r = rooms.get(String(msg.code || '').toUpperCase());
      if (!r) return ws.send({ t: 'error', error: 'No arcade is running with that code. Check the code on the big screen.' });
      role = 'pad'; room = r;
      pad = { id: nextPadId++, ws, name: String(msg.name || 'Player').slice(0, 14), device: String(msg.device || 'phone').slice(0, 12), slot: freeSlot(r, msg.slot) };
      r.pads.set(pad.id, pad);
      broadcastPads(r);
    } else if (role === 'pad' && msg.t === 'in' && room && room.host) {
      // input relay: keep it tiny and fast
      if (pad.slot === 'p1' || pad.slot === 'p2') room.host.send({ t: 'in', s: pad.slot, k: msg.k, d: msg.d ? 1 : 0 });
    } else if (role === 'pad' && msg.t === 'name' && pad) {
      pad.name = String(msg.name || 'Player').slice(0, 14); broadcastPads(room);
    } else if (role === 'host' && msg.t === 'assign' && room) {
      const p = room.pads.get(msg.id); if (!p) return;
      const other = [...room.pads.values()].find(x => x.slot === msg.slot && x !== p);
      if (other) other.slot = p.slot;   // swap
      p.slot = msg.slot; broadcastPads(room);
    } else if (role === 'host' && msg.t === 'kick' && room) {
      const p = room.pads.get(msg.id); if (p) { p.ws.send({ t: 'error', error: 'The host removed you from the cabinet.' }); p.ws.close(); }
    } else if (role === 'host' && msg.t === 'say' && room) {
      for (const p of room.pads.values()) p.ws.send({ t: 'say', text: String(msg.text || '').slice(0, 120), rumble: !!msg.rumble, slot: msg.slot });
    } else if (msg.t === 'ping') ws.send({ t: 'pong', at: msg.at });
  };
  ws.onclose = () => {
    if (!room) return;
    if (role === 'host') {
      room.host = null;
      for (const p of room.pads.values()) p.ws.send({ t: 'say', text: 'The big screen disconnected. Hold on...' });
      setTimeout(() => { if (!room.host && rooms.get(room.code) === room) { for (const p of room.pads.values()) p.ws.close(); rooms.delete(room.code); } }, 5 * 60 * 1000);
    } else if (pad) {
      room.pads.delete(pad.id);
      if (pad.slot === 'p1' || pad.slot === 'p2') {
        // release any held buttons on the big screen and promote the next waiting player
        room.host && room.host.send({ t: 'release', s: pad.slot });
        const waiting = [...room.pads.values()].find(p => p.slot === 'wait');
        if (waiting) waiting.slot = pad.slot;
      }
      broadcastPads(room);
    }
  };
}

// ---------------------------------------------------------------------------
// HTTP routing
// ---------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/info') {
      const fsFile = FS_ZIPS.find(f => fs.existsSync(path.join(PUBLIC, 'game', f))) || null;
      return send(res, 200, { lan: lanAddresses(), port: activePort, httpsPort: activeHttpsPort, runtime: fs.existsSync(path.join(PUBLIC, 'runtime', 'boxedwine.js')), filesystem: !!fsFile, filesystemFile: fsFile, game: fs.existsSync(path.join(PUBLIC, 'game', 'openmortal.zip')) });
    }
    if (p === '/api/fighters' && req.method === 'GET') return send(res, 200, await listFighters());
    if (p === '/api/fighters' && req.method === 'POST') return send(res, 201, await saveFighter(await readBody(req)));
    let m;
    if ((m = /^\/api\/fighters\/([A-Za-z0-9]+)(?:\/(pack\.zip|icon\.png|full\.png))?$/.exec(p))) {
      const c = sanitizeCodename(m[1]);
      if (req.method === 'DELETE') {
        for (const ext of ['.zip', '.json', '.icon.png', '.full.png']) await fsp.rm(path.join(FIGHTERS, c + ext), { force: true });
        return send(res, 200, { ok: true });
      }
      const file = { 'pack.zip': `${c}.zip`, 'icon.png': `${c}.icon.png`, 'full.png': `${c}.full.png` }[m[2] || 'pack.zip'];
      const fp = path.join(FIGHTERS, file);
      if (!fs.existsSync(fp)) return send(res, 404, { error: 'No such fighter' });
      const type = file.endsWith('.zip') ? 'application/zip' : 'image/png';
      isolationHeaders(res);
      res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': file.endsWith('.zip') ? `attachment; filename="${c}-openmortal-fighter.zip"` : 'inline', 'Cache-Control': 'no-store' });
      return fs.createReadStream(fp).pipe(res);
    }
    if (p === '/api/stock') return send(res, 200, await stockFighters());
    if ((m = /^\/api\/stock\/([A-Za-z]+)\/([A-Za-z]+\.(?:pl|dat|dat\.txt|icon\.png|full\.png))$/.exec(p))) {
      const data = await stockFile(`data/characters/${m[2]}`);
      if (!data || !m[2].startsWith(m[1] + '.')) return send(res, 404, { error: 'No such stock file' });
      isolationHeaders(res);
      res.writeHead(200, { 'Content-Type': m[2].endsWith('.png') ? 'image/png' : 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
      return res.end(data);
    }
    if (p === '/api/stages' && req.method === 'GET') return send(res, 200, await listStages());
    if (p === '/api/stages' && req.method === 'POST') return send(res, 201, await saveStage(await readBody(req)));
    if ((m = /^\/api\/stages\/([a-f0-9]+)(?:\/(stage\.zip|preview\.png))?$/.exec(p))) {
      if (req.method === 'DELETE') { for (const ext of ['.zip', '.json', '.preview.png']) await fsp.rm(path.join(STAGES, m[1] + ext), { force: true }); return send(res, 200, { ok: true }); }
      const fp = path.join(STAGES, m[2] === 'preview.png' ? `${m[1]}.preview.png` : `${m[1]}.zip`);
      if (!fs.existsSync(fp)) return send(res, 404, { error: 'No such stage' });
      isolationHeaders(res); res.writeHead(200, { 'Content-Type': fp.endsWith('.png') ? 'image/png' : 'application/zip', 'Cache-Control': 'no-store' });
      return fs.createReadStream(fp).pipe(res);
    }
    if (p === '/api/roster' && req.method === 'POST') {
      const body = JSON.parse(new TextDecoder().decode(await readBody(req, 1 << 16)));
      const id = crypto.randomBytes(6).toString('hex');
      rosters.set(id, { fighters: (body.fighters || []).map(String), stages: (body.stages || []).map(String), settings: body.settings || {} });
      if (rosters.size > 50) rosters.delete(rosters.keys().next().value);
      return send(res, 201, { id, overlay: `/api/overlay/${id}/` });
    }
    if ((m = /^\/api\/overlay\/([a-f0-9]+)\/custom\.zip$/.exec(p))) {
      const r = rosters.get(m[1]); if (!r) return send(res, 404, { error: 'Unknown roster' });
      return send(res, 200, await buildOverlay(r), 'application/zip');
    }
    if ((m = /^\/api\/overlay\/[a-f0-9]+\/(.+\.zip)$/.exec(p))) return serveStatic(req, res, `/game/${m[1]}`);
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Unknown API route' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    return serveStatic(req, res, p === '/' ? '/index.html' : p);
  } catch (e) {
    console.error(e);
    return send(res, e.status || 500, { error: e.message || 'Server error' });
  }
}

function attach(server) {
  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
    const ws = wsAccept(req, socket); if (ws) onWebSocket(ws);
  });
  return server;
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function probeArcade(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j && 'runtime' in j && 'game' in j ? j : null;
  } catch { return null; }
}

// listen on `first`, or the next free port when it is taken (unless the port was set explicitly)
function listenWithFallback(server, first, explicit) {
  return new Promise((resolve, reject) => {
    let port = first;
    const onError = e => {
      if (e.code === 'EADDRINUSE' && !explicit && port < first + 20) { port++; tryPort(); }
      else reject(Object.assign(e, { port }));
    };
    const tryPort = () => {
      server.once('error', onError);
      server.listen(port, '0.0.0.0', () => { server.off('error', onError); resolve(port); });
    };
    tryPort();
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}

// a certificate for localhost and every LAN address, remade when the addresses change
// (the event Wi-Fi gives this PC a different address than home) or it is close to expiring
function ensureCert() {
  const dir = path.join(DATA, 'cert');
  const keyFile = path.join(dir, 'key.pem'), certFile = path.join(dir, 'cert.pem');
  const ips = ['127.0.0.1', ...lanAddresses()];
  try {
    const cert = new crypto.X509Certificate(fs.readFileSync(certFile));
    const covered = ips.every(ip => (cert.subjectAltName || '').includes(`IP Address:${ip}`));
    const fresh = new Date(cert.validTo).getTime() - Date.now() > 7 * 86400000;
    if (covered && fresh && fs.existsSync(keyFile)) return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  } catch {}
  const host = os.hostname();
  const names = ['localhost', ...(/^[a-z0-9-]+$/i.test(host) ? [host, `${host}.local`] : [])];
  const made = makeSelfSignedCert({ names, ips });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, made.key); fs.writeFileSync(certFile, made.cert);
  return made;
}

function handOver(port) {
  console.log(`\n  The arcade is already running at http://localhost:${port}/ (in another window).`);
  if (WANT_OPEN) { console.log('  Opening it in your browser.\n'); openBrowser(`http://localhost:${port}/`); }
  setTimeout(() => process.exit(0), 300);
}

async function start() {
  const httpServer = attach(http.createServer(handle));
  try {
    activePort = await listenWithFallback(httpServer, PORT, !!process.env.PORT);
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    if (await probeArcade(e.port)) return handOver(e.port);
    console.log(`\n  Port ${e.port} is already in use. Pick another one, for example:\n    PORT=9000 node server/server.mjs\n`);
    process.exit(1);
  }
  // the arcade may already be running from an earlier double-click: hand over to it
  if (activePort !== PORT && await probeArcade(PORT)) { httpServer.close(); return handOver(PORT); }
  if (WANT_HTTPS) {
    try {
      const tls = ensureCert();
      activeHttpsPort = await listenWithFallback(attach(https.createServer(tls, handle)), HTTPS_PORT, !!process.env.HTTPS_PORT);
    } catch (e) {
      console.log(`  ! https could not start (${e.message}). Phones can still play; only phone cameras need https.`);
    }
  }
  const lan = lanAddresses();
  const out = ['', '  MORTAL ARCADE is running', '',
    `  Big screen (this computer):  http://localhost:${activePort}/host.html`];
  if (lan.length) out.push(`  Players join at:             http://${lan[0]}:${activePort}/pad  (or scan the code on the big screen)`);
  if (activeHttpsPort && lan.length) out.push(`  Filming with a phone:        https://${lan[0]}:${activeHttpsPort}/create.html  (accept the warning once)`);
  for (const a of lan.slice(1)) out.push(`  Other address of this PC:    ${a}`);
  if (!fs.existsSync(path.join(PUBLIC, 'game', 'openmortal.zip'))) out.push('', '  ! public/game/openmortal.zip is missing. Run: node tools/build-game-zip.mjs');
  if (!FS_ZIPS.some(f => fs.existsSync(path.join(PUBLIC, 'game', f))))
    out.push('', '  ! The Boxedwine file system is missing, so the big screen cannot boot the game yet.',
      '    Double-click "Start Arcade" to fetch it, or put TinyCore15Wine11.0-web.zip in public/game/.');
  if (process.platform === 'win32') out.push('', '  If phones cannot connect: when Windows Firewall asks about Node.js, allow Private networks.');
  out.push('', '  Keep this window open while you play. Close it or press Ctrl+C to stop the arcade.', '');
  console.log(out.join('\n'));
  if (WANT_OPEN) openBrowser(`http://localhost:${activePort}/`);
}

start();
