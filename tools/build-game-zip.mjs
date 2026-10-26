// Packs an installed/extracted OpenMortal 0.7 folder (the one with bin/ and data/)
// into public/game/openmortal.zip, laid out where the emulated Windows expects it
// (C:\OpenMortal inside Boxedwine's Wine prefix). The game files are not modified.
// usage: node tools/build-game-zip.mjs "C:/Program Files (x86)/OpenMortal"
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { writeZip } from '../public/js/zip.js';
import { buildIni } from '../public/js/omformat.js';

const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, 'bin', 'OpenMortal.exe'))) {
  console.error('Give me the OpenMortal folder that contains bin/OpenMortal.exe and data/.');
  process.exit(1);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(HERE, '..', 'public', 'game', 'openmortal.zip');
const PREFIX = 'home/username/.wine/drive_c/OpenMortal/';
const entries = [];
(function walk(dir, rel) {
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f), r = rel ? `${rel}/${f}` : f;
    if (fs.statSync(full).isDirectory()) walk(full, r);
    else if (!/^(stderr|stdout)\.txt$|\.exe\.ini$/i.test(f)) entries.push({ name: PREFIX + r, data: fs.readFileSync(full) });
  }
})(src, '');
entries.push({ name: PREFIX + 'bin/OpenMortal.exe.ini', data: buildIni() });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, writeZip(entries, d => zlib.deflateRawSync(d, { level: 9 })));
console.log(`wrote ${out} (${entries.length} files, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
