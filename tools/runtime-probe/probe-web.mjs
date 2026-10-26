// Boots public/runtime/arcade.html (or public/runtime-mt/) with Boxedwine in Chromium, using the
// probe root (public/game/probe-root.zip) and the arcade's real overlays, then injects keys
// through window.arcade.key() exactly like js/host.js does. keyprobe prints what reaches the
// guest: injected files, the ini that won, and every key event.
//
//   node tools/runtime-probe/probe-web.mjs http://localhost:8080 /api/overlay/<roster id>/ probe.png [runtime|runtime-mt]
//
// Needs Playwright with Chromium 137 or newer (npm i -D playwright).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const [base = 'http://localhost:8080', overlay, shot = 'probe.png', rt = 'runtime'] = process.argv.slice(2);
if (!overlay) { console.log('Pass the overlay path from POST /api/roster, for example /api/overlay/abc123/'); process.exit(1); }
const files = ['data/characters/zzRoster.pl', 'data/characters/Kinga.pl', 'data/gfx/level12.jpg', 'bin/OpenMortal.exe'];
// built by hand: the shell splits the overlay list on a raw ";"
const url = `${base}/${rt}/arcade.html?root=probe-root.zip&rootBase=/game/&overlay=custom.zip;openmortal.zip&overlayBase=${overlay}`
  + `&p=/bin/keyprobe&linux=true&args=${encodeURI(files.join(' '))}&w=/&storage=memory&resolution=640x480&sound=false`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const lines = [];
page.on('console', m => { const t = m.text(); lines.push(t); if (t.startsWith('PROBE')) console.log(t); });
page.context().on('response', r => { if (r.status() >= 400 && !r.url().endsWith('wasm-jit-modules.zip')) console.log('HTTP', r.status(), r.url()); });
page.on('pageerror', e => console.log('page error:', e.message));
const t0 = Date.now();
await page.goto(url);
for (let i = 0; i < 240 && !lines.some(l => l.includes('PROBE window up')); i++) await page.waitForTimeout(500);
console.log(`guest window after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.waitForTimeout(1000);
const codes = ['Delete', 'Insert', 'Home', 'End', 'PageDown', 'ArrowUp', 'ArrowLeft', 'KeyW', 'KeyF', 'Escape', 'Enter', 'F1'];
for (const code of codes) {
  await page.evaluate(c => window.arcade.key(c, true), code); await page.waitForTimeout(100);
  await page.evaluate(c => window.arcade.key(c, false), code); await page.waitForTimeout(100);
}
await page.waitForTimeout(1000);
await page.screenshot({ path: shot });
const got = lines.filter(l => l.startsWith('PROBE key down')).length;
console.log(`${got} of ${codes.length} key presses reached the guest. Screenshot: ${shot}`);
await browser.close();
process.exit(got === codes.length ? 0 : 1);
