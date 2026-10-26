#!/usr/bin/env node
// setup.mjs - what "Start Arcade" runs. It checks Node, makes sure Boxedwine's Windows file
// system is in public/game (reusing a copy from Downloads, or downloading and checking it),
// then starts the arcade with https on and opens the browser.
//
//   node tools/setup.mjs              set up, start, open the browser
//   node tools/setup.mjs --no-open    set up and start, no browser
//   node tools/setup.mjs --no-start   only set up
//   node tools/setup.mjs --http-only  start without https (phone cameras will not work)
//   MA_FS_URL=<url> node tools/setup.mjs   download the file system from your own mirror
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = path.join(ROOT, 'public', 'game');
const args = process.argv.slice(2);
const MIN_NODE = 20;

const FS_WEB = 'TinyCore15Wine11.0-web.zip';
const FS_FULL = 'TinyCore15Wine11.0.zip';
const FS_PATTERN = /^TinyCore15Wine11\.0(-web)?\b.*\.zip$/i;     // also "... (1).zip" from a browser
// Published Boxedwine file systems (sizes and SHA-256 from the Boxedwine repository's manifests)
const KNOWN = {
  d91b88906a8ec03164f27ed0a39bff8256740e13eb9233232a28ff9cc32817a1: 'web, revision 21',
  '21beaeea9566fe214a5d5fd4d605cae467166d1e6cd1458a8e6fef79fe5bb631': 'web, revision 20',
  d2619210a8592e0c952537bfa20ef59e6af54d70a0105b0a7aa80ee70dda688f: 'web, revision 19',
  '6138028058adf98799022446db2494b7cccf23962e6fd4e5f681a3113294ff88': 'full, revision 21',
  '27797aa3d063f840389901349006f628e67a6e7d811a16cfb455b101e697a1ec': 'full, revision 20',
  '95e88dfa2e97ee11177ca1f9eed2e24a9f90bc538c86adc922d992ebf6e2e0d8': 'full, revision 19',
};
const SOURCES = process.env.MA_FS_URL ? [process.env.MA_FS_URL] : [
  `https://boxedwine.org/v2/21/${FS_WEB}`,
  `https://boxedwine.org/v2/20/${FS_WEB}`,
  `https://boxedwine.org/v2/latest/${FS_WEB}`,
  `https://boxedwine.org/v2/latest/${FS_FULL}`,
];

const say = (...lines) => console.log(lines.map(l => `  ${l}`).join('\n'));
const mb = n => (n / 1048576).toFixed(1);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
function checkNode() {
  const major = +process.versions.node.split('.')[0];
  if (major < MIN_NODE) {
    say(`This computer has Node.js ${process.versions.node}; the arcade needs ${MIN_NODE} or newer.`,
      'Double-click "Start Arcade" (it can fetch a private copy), or install the LTS version from https://nodejs.org/');
    process.exit(1);
  }
}

// 'ok' = a zip with Boxedwine's Wine prefix inside, 'zip' = a complete zip without it,
// 'bad' = not a complete zip (an interrupted download, an HTML error page saved as .zip, ...)
async function checkFilesystem(file) {
  try {
    const st = await fsp.stat(file);
    if (st.size < 30 * 1048576) return 'bad';
    const fh = await fsp.open(file, 'r');
    try {
      const read = async (len, pos) => { const b = Buffer.alloc(len); await fh.read(b, 0, len, pos); return b; };
      if ((await read(4, 0)).readUInt32LE(0) !== 0x04034b50) return 'bad';
      const tailLen = Math.min(st.size, 65557 + 20), tailPos = st.size - tailLen, tail = await read(tailLen, tailPos);
      const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (eocd < 0) return 'bad';
      let cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
      const loc = eocd - 20;   // zip64: the locator sits right before the end record
      if ((cdOffset === 0xffffffff || cdSize === 0xffffffff) && loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) {
        const rec = await read(56, Number(tail.readBigUInt64LE(loc + 8)));
        if (rec.readUInt32LE(0) !== 0x06064b50) return 'bad';
        cdSize = Number(rec.readBigUInt64LE(40)); cdOffset = Number(rec.readBigUInt64LE(48));
      }
      if (cdOffset + cdSize > st.size || cdSize > 256 * 1048576) return 'bad';
      const cd = await read(cdSize, cdOffset);
      if (cd.readUInt32LE(0) !== 0x02014b50) return 'bad';
      return cd.includes('home/username/.wine/') ? 'ok' : 'zip';
    } finally { await fh.close(); }
  } catch { return 'bad'; }
}

async function sha256(file) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

const canonicalName = name => (/-web/i.test(name) ? FS_WEB : FS_FULL);

async function findInFolder(dir) {
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const hits = [];
  for (const n of names) {
    if (!FS_PATTERN.test(n)) continue;
    const full = path.join(dir, n);
    try { hits.push({ file: full, name: n, mtime: (await fsp.stat(full)).mtimeMs }); } catch {}
  }
  return hits.sort((a, b) => b.mtime - a.mtime);
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
// plain http(s) instead of fetch: steadier for a 100 MB stream, follows redirects, gives up
// when the connection goes quiet for 30 seconds
function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('https:') ? https : http).get(url, { headers: { 'user-agent': 'mortal-arcade-setup' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume(); resolve(get(new URL(res.headers.location, url).href, redirects - 1)); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`the server answered ${res.statusCode}`)); return; }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('the download stalled')));
  });
}

async function download(url, dest) {
  const res = await get(url);
  const total = +res.headers['content-length'] || 0;
  const part = dest + '.part';
  const hash = crypto.createHash('sha256');
  let got = 0, lastShown = 0, lastPct = -10;
  const t0 = Date.now();
  const show = (final = false) => {
    const pct = total ? Math.floor(got * 100 / total) : 0;
    const speed = got / Math.max(0.5, (Date.now() - t0) / 1000);
    const line = `Downloading  ${total ? `${String(pct).padStart(3)}%  ` : ''}${mb(got)}${total ? ` of ${mb(total)}` : ''} MB  ${mb(speed)} MB/s`;
    if (process.stdout.isTTY) process.stdout.write(`\r  ${line}   ${final ? '\n' : ''}`);
    else if (final || pct >= lastPct + 10) { console.log(`  ${line}`); lastPct = pct; }
  };
  res.on('data', chunk => {
    got += chunk.length; hash.update(chunk);
    if (Date.now() - lastShown > 250) { show(); lastShown = Date.now(); }
  });
  await pipeline(res, fs.createWriteStream(part));
  show(true);
  if (total && got !== total) throw new Error(`the download stopped at ${mb(got)} of ${mb(total)} MB`);
  return { part, sha: hash.digest('hex') };
}

// ---------------------------------------------------------------------------
// The Windows file system
// ---------------------------------------------------------------------------
async function ensureFilesystem() {
  await fsp.mkdir(GAME, { recursive: true });

  // 1. already in place
  for (const n of [FS_WEB, FS_FULL]) {
    const f = path.join(GAME, n);
    if (fs.existsSync(f)) {
      const state = await checkFilesystem(f);
      if (state === 'ok') { say(`Windows file system: ready (${n}).`); return true; }
      if (state === 'zip') { say(`Windows file system: using ${n} (it does not look like Boxedwine's usual layout; if the game will not boot, delete it and start again).`); return true; }
      say(`! public/game/${n} looks incomplete (an interrupted download?). Moving it aside as ${n}.broken and getting a fresh copy.`);
      await fsp.rename(f, f + '.broken').catch(() => {});
    }
  }

  // 2. in public/game under a browser-mangled name, or 3. in Downloads
  const downloads = [...new Set([path.join(os.homedir(), 'Downloads'), process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'Downloads')].filter(Boolean))];
  for (const dir of [GAME, ...downloads]) {
    for (const hit of await findInFolder(dir)) {
      if ((await checkFilesystem(hit.file)) !== 'ok') continue;
      const dest = path.join(GAME, canonicalName(hit.name));
      if (dir === GAME) { await fsp.rename(hit.file, dest); say(`Windows file system: renamed ${hit.name} to ${path.basename(dest)}.`); }
      else { say(`Windows file system: copying ${hit.name} from your Downloads...`); await fsp.copyFile(hit.file, dest); say('Copied.'); }
      return true;
    }
  }

  // 4. download
  say(`Windows file system: not found, downloading it from ${process.env.MA_FS_URL ? 'your mirror' : 'boxedwine.org'} (about 100 MB, only once).`);
  for (const url of SOURCES) {
    const dest = path.join(GAME, canonicalName(path.basename(new URL(url).pathname)));
    try {
      say(`From ${url}`);
      const { part, sha } = await download(url, dest);
      if ((await checkFilesystem(part)) !== 'ok') { await fsp.rm(part, { force: true }); say('! That file is not a Boxedwine file system. Trying the next address.'); continue; }
      await fsp.rename(part, dest);
      say(KNOWN[sha] ? `Checked: this is Boxedwine's published file system (${KNOWN[sha]}).`
        : 'Downloaded. It is a newer Boxedwine release than the ones this arcade was tested with, so if the game will not boot, tell whoever maintains the arcade.');
      return true;
    } catch (e) {
      await fsp.rm(dest + '.part', { force: true }).catch(() => {});
      if (process.stdout.isTTY) process.stdout.write('\n');
      say(`! ${e.message}. Trying the next address.`);
    }
  }
  say('', '! Could not download the Windows file system. Everything except the big-screen game still works.',
    '  To fix it: download this file in your browser and put it in the public/game folder:',
    `    https://boxedwine.org/v2/21/${FS_WEB}`,
    '  (if that address does not work, change 21 to 20). Then start the arcade again.');
  return false;
}

// ---------------------------------------------------------------------------
async function main() {
  console.log('\n  MORTAL ARCADE setup\n');
  checkNode();
  say(`Node.js ${process.versions.node}: ok.`);
  if (!fs.existsSync(path.join(GAME, 'openmortal.zip'))) say('! public/game/openmortal.zip is missing. Unzip the arcade again, or run: node tools/build-game-zip.mjs <OpenMortal folder>');
  if (!fs.existsSync(path.join(ROOT, 'public', 'runtime', 'boxedwine.wasm'))) say('! public/runtime/boxedwine.wasm is missing. Unzip the arcade again.');
  await ensureFilesystem();
  if (args.includes('--no-start')) return;
  process.argv = [process.argv[0], path.join(ROOT, 'server', 'server.mjs'),
    ...(args.includes('--http-only') ? [] : ['--https']), ...(args.includes('--no-open') ? [] : ['--open'])];
  await import(pathToFileURL(path.join(ROOT, 'server', 'server.mjs')).href);
}

main().catch(e => { console.error('\n  Setup failed:', e.message, '\n'); process.exit(1); });
