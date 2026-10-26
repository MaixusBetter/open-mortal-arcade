// host.js - the big screen: runs OpenMortal in Boxedwine and routes every controller into it.
import { $, h, toast, api, blip } from './ui.js';
import { keyFor, KEYBOARD_MAP, GamepadPoller, SLOT_KEYS } from './controls.js';
import qrcode from '../vendor/qrcode/qrcode.mjs';

const MAX_FIGHTERS = 12;
const GAME_BIN = '/home/username/.wine/drive_c/OpenMortal/bin';
const state = {
  ws: null, code: sessionStorage.getItem('ma-room') || '', pads: [], info: null,
  picks: new Set(JSON.parse(localStorageGet('ma-picks') || '[]')), stagePicks: new Set(JSON.parse(localStorageGet('ma-stages') || '[]')),
  gamepads: new Map(),   // gamepad index -> slot
  iframe: null, running: false,
  settings: {},          // the rules the cabinet was powered on with
  kbP2At: 0,             // last time someone used Player 2's keys on this keyboard
  game: null,            // the game's own status (runtime/arcade.html readState)
  sentControl: '', controlSeq: 0, picking: false, lastPick: 0,
};
const KEYBOARD_SEAT_MS = 90000;   // a keyboard Player 2 keeps the seat this long after their last key

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

// ---------------------------------------------------------------------------
// Room + join code
// ---------------------------------------------------------------------------
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'host', code: state.code }));
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'room') { state.code = m.code; sessionStorage.setItem('ma-room', m.code); showJoin(m); }
    else if (m.t === 'pads') { const before = new Set(state.pads.map(p => p.id)); state.pads = m.pads; for (const p of m.pads) if (!before.has(p.id)) { toast(`${p.name} joined${p.slot === 'wait' ? ' the queue' : ` as Player ${p.slot.slice(1)}`}`); blip('ok'); } renderSeats(); }
    else if (m.t === 'in') press(m.s, m.k, !!m.d, 'pad');
    else if (m.t === 'release') releaseSlot(m.s);
  };
  ws.onclose = () => { $('#joinUrl').textContent = 'reconnecting...'; setTimeout(connect, 1500); };
}

function showJoin(m) {
  $('#code').textContent = m.code;
  // phones need the LAN address, not "localhost"
  let host = location.host;
  if (/^(localhost|127\.)/.test(location.hostname) && m.lan && m.lan.length) host = `${m.lan[0]}:${location.protocol === "https:" && m.httpsPort ? m.httpsPort : m.port}`;
  const url = `${location.protocol}//${host}/pad.html?code=${m.code}`;
  $('#joinUrl').textContent = `${host}/pad`;
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const c = $('#qr'), n = qr.getModuleCount(), ctx = c.getContext('2d');
  const s = Math.floor(82 / n); c.width = n * s; c.height = n * s;
  ctx.fillStyle = '#efe3c8'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#120d0b';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) ctx.fillRect(x * s, y * s, s, s);
  c.title = url;
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------
function seatOwner(slot) {
  const pad = state.pads.find(p => p.slot === slot);
  if (pad) return { name: pad.name, dev: pad.device === 'laptop' ? 'Laptop controller' : 'Phone controller' };
  for (const [idx, s] of state.gamepads) if (s === slot) { const gp = navigator.getGamepads()[idx]; return { name: `Gamepad ${idx + 1}`, dev: gp ? gp.id.replace(/\(.*?\)/g, '').trim().slice(0, 40) : 'Gamepad' }; }
  if (slot === 'p2' && Date.now() - state.kbP2At < KEYBOARD_SEAT_MS) return { name: 'Keyboard', dev: 'W A S D and R F T G X on this computer' };
  return null;
}

// the computer plays Player 2 while nobody sits there (and the cabinet was set up for it)
function cpuPlaysP2() {
  return state.running && state.settings.cpu !== 'off' && !seatOwner('p2');
}

const SKILL = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
function renderSeats() {
  for (const slot of ['p1', 'p2']) {
    const el = $(`#seat-${slot}`);
    let o = seatOwner(slot);
    if (!o && slot === 'p2' && cpuPlaysP2()) o = { name: 'Computer', dev: `${SKILL[state.settings.cpuLevel] || 'Normal'} skill. Join, or press a Player 2 key, to take over.` };
    el.classList.toggle('empty', !o);
    el.querySelector('.who').textContent = o ? o.name : 'Open seat';
    el.querySelector('.dev').textContent = o ? o.dev : slot === 'p1' ? 'Scan the code, or use the keyboard: arrows and J U K I L' : 'Scan the code, or use the keyboard: W A S D and R F T G X';
  }
  const waiting = state.pads.filter(p => p.slot === 'wait');
  const q = $('#queue'); q.innerHTML = '';
  if (waiting.length) {
    q.append(h('b', {}, 'Next up'), h('ul', {}, waiting.map(p => h('li', {}, h('span', {}, p.name),
      h('span', {}, h('button', { class: 'slab small', onclick: () => assign(p.id, 'p1') }, 'P1'), ' ', h('button', { class: 'slab small', onclick: () => assign(p.id, 'p2') }, 'P2'))))));
  }
}
function assign(id, slot) { state.ws && state.ws.send(JSON.stringify({ t: 'assign', id, slot })); }

// ---------------------------------------------------------------------------
// Input -> Boxedwine
// ---------------------------------------------------------------------------
const lampIndex = { up: 0, down: 0, left: 0, right: 0, lp: 1, hp: 2, lk: 3, hk: 4, block: 1 };
function press(slot, button, down, source) {
  const code = keyFor(slot, button);
  if (!code) return;
  const bridge = state.iframe && state.iframe.contentWindow && state.iframe.contentWindow.arcade;
  if (bridge) bridge.key(code, down);
  if (slot) {
    const lamp = document.querySelectorAll(`#lamps-${slot} i`)[lampIndex[button] ?? 0];
    if (lamp) lamp.classList.toggle('on', down);
  }
}
function releaseSlot(slot) {
  for (const b of Object.keys(SLOT_KEYS[slot] || {})) press(slot, b, false);
}

// physical keyboard on this machine (when the game frame isn't focused)
const forwarded = new Set();
addEventListener('keydown', e => {
  if (!state.running || e.target.closest('input, select, textarea')) return;
  const m = KEYBOARD_MAP[e.code]; if (!m) return;
  e.preventDefault(); if (e.repeat) return;
  forwarded.add(e.code); press(m[0], m[1], true, 'kbd'); noteKeyboard(m[0]);
});
addEventListener('keyup', e => {
  const m = KEYBOARD_MAP[e.code]; if (!m || !forwarded.has(e.code)) return;
  forwarded.delete(e.code); press(m[0], m[1], false, 'kbd');
});
// the same keyboard while the game frame has focus (runtime/arcade.html calls this)
window.arcadeHostKey = (code, down, repeat) => {
  const m = KEYBOARD_MAP[code]; if (!m) return false;
  if (repeat) return true;
  if (down) forwarded.add(code); else if (!forwarded.delete(code)) return true;
  press(m[0], m[1], down, 'kbd');
  if (down) noteKeyboard(m[0]);
  return true;
};
function noteKeyboard(slot) {
  if (slot !== 'p2') return;
  const had = Date.now() - state.kbP2At < KEYBOARD_SEAT_MS;
  state.kbP2At = Date.now();
  if (!had) renderSeats();
}

// gamepads plugged into this machine: first button press takes a free seat
new GamepadPoller((idx, button, down, gp) => {
  let slot = state.gamepads.get(idx);
  if (!slot && down) {
    const taken = new Set([...state.gamepads.values(), ...state.pads.map(p => p.slot)]);
    slot = ['p1', 'p2'].find(s => !taken.has(s));
    if (!slot) { toast('Both seats are taken. Free one in the queue panel first.'); return; }
    state.gamepads.set(idx, slot); toast(`Gamepad ${idx + 1} is Player ${slot.slice(1)}`); blip('ok'); renderSeats();
  }
  if (slot) press(slot, button, down, 'gamepad');
}).start();
addEventListener('gamepaddisconnected', e => { const s = state.gamepads.get(e.gamepad.index); if (s) { releaseSlot(s); state.gamepads.delete(e.gamepad.index); renderSeats(); } });

// ---------------------------------------------------------------------------
// Cabinet setup: roster + boot
// ---------------------------------------------------------------------------
async function loadLists() {
  const [fighters, stages] = await Promise.all([api('api/fighters').catch(() => []), api('api/stages').catch(() => [])]);
  const fg = $('#fighters'); fg.innerHTML = '';
  if (!fighters.length) fg.append(h('p', { class: 'empty-note' }, 'No custom fighters yet. Make one on the "Make a fighter" screen and press Send to the arcade. The 18 stock fighters are always in.'));
  for (const f of fighters) {
    const b = h('button', { class: 'pick', 'aria-pressed': String(state.picks.has(f.codename)), title: `${f.name} (${f.style || 'fighter'})` },
      h('img', { src: `api/fighters/${f.codename}/icon.png`, alt: '' }), h('span', {}, f.name));
    b.onclick = () => {
      if (state.picks.has(f.codename)) state.picks.delete(f.codename);
      else if (state.picks.size >= MAX_FIGHTERS) return toast(`The select screen holds ${MAX_FIGHTERS} custom fighters next to the 18 stock ones.`, { error: true });
      else state.picks.add(f.codename);
      b.setAttribute('aria-pressed', String(state.picks.has(f.codename))); blip('move'); count();
    };
    fg.append(b);
  }
  // forget picks that no longer exist
  for (const c of [...state.picks]) if (!fighters.some(f => f.codename === c)) state.picks.delete(c);
  const sg = $('#stages'); sg.innerHTML = '';
  if (!stages.length) sg.append(h('p', { class: 'empty-note' }, 'No custom stages yet. The 11 stock stages rotate as usual.'));
  // the game plays custom stages first, oldest submission first; stages sent since the last
  // visit are ticked automatically
  stages.sort((a, b) => (a.created || 0) - (b.created || 0));
  const seen = new Set(JSON.parse(localStorageGet('ma-stages-seen') || '[]'));
  for (const st of stages) if (!seen.has(st.id)) state.stagePicks.add(st.id);
  localStorageSet('ma-stages-seen', JSON.stringify(stages.map(st => st.id)));
  const renumber = () => { let n = 0; for (const b of sg.querySelectorAll('.pick')) { const on = state.stagePicks.has(b.dataset.id); b.querySelector('.order').textContent = on ? ++n : ''; b.querySelector('.order').hidden = !on; } };
  for (const st of stages) {
    const b = h('button', { class: 'pick stage', 'data-id': st.id, 'aria-pressed': String(state.stagePicks.has(st.id)), title: st.name },
      h('img', { src: `api/stages/${st.id}/preview.png`, alt: '' }), h('span', {}, st.name), h('b', { class: 'order' }));
    b.onclick = () => { state.stagePicks.has(st.id) ? state.stagePicks.delete(st.id) : state.stagePicks.add(st.id); b.setAttribute('aria-pressed', String(state.stagePicks.has(st.id))); renumber(); blip('move'); };
    sg.append(b);
  }
  renumber();
  for (const c of [...state.stagePicks]) if (!stages.some(s => s.id === c)) state.stagePicks.delete(c);
  count();
}
function count() { $('#fcount').textContent = `${state.picks.size} of ${MAX_FIGHTERS} picked`; }

// The Boxedwine shell reads its URL by hand: it splits the overlay list on a raw ";" and
// expects env as "NAME:value" in quotes, so the query is built here instead of with
// URLSearchParams (which would encode ";" and ":").
function runtimeUrl(filesystemFile, overlayBase) {
  // Graphics. DirectDraw (SDL's default driver) hands each frame to Boxedwine's WebGL
  // Direct3D, so the browser's GPU does the colour conversion and scaling. GDI ("windib", the
  // Windows 11 fix) converts every frame inside the emulated Windows: on a desktop PC that was
  // over half the game's work, which in the emulator makes it slow. GDI stays as the fallback
  // for machines where DirectDraw shows a black picture. host.html?sdl=windib|directx overrides.
  const forced = new URLSearchParams(location.search).get('sdl');
  const gdi = forced ? forced === 'windib' : state.settings.graphics === 'gdi';
  // the shell takes one environment variable: GDI needs SDL_VIDEODRIVER; with DirectDraw,
  // Wine's own log is switched off so it never costs time in the browser console
  const env = gdi ? '"SDL_VIDEODRIVER:windib"' : '"WINEDEBUG:-all"';
  const q = [
    ['root', filesystemFile], ['rootBase', '/game/'],
    ['overlay', 'custom.zip;openmortal.zip'], ['overlayBase', overlayBase],   // first zip wins
    ['p', 'OpenMortal.exe'], ['w', GAME_BIN],
    ['env', env],
    ['storage', 'memory'], ['resolution', '640x480'], ['sound', 'true'], ['audioFreq', '22050'],
  ];
  // The single-threaded build is the default: running the real game, it booted twice as fast
  // as the multi-threaded one, fought about a third faster, and its memory stays flat, while
  // the multi-threaded build kept growing by 12 to 20 MB a second during fights until the tab
  // ran out of memory. host.html?runtime=mt still opens the multi-threaded build (it needs
  // cross-origin isolation, which the arcade's server sets up on localhost and https).
  const st = new URLSearchParams(location.search).get('runtime') !== 'mt' || !window.crossOriginIsolated;
  return `${st ? 'runtime' : 'runtime-mt'}/arcade.html?` + q.map(([k, v]) => `${k}=${encodeURI(v)}`).join('&');
}

async function powerOn() {
  const info = state.info || await api('api/info');
  if (!info.game || !info.runtime || !info.filesystem) {
    return toast(!info.filesystem ? 'The Boxedwine file system zip is missing from public/game/. See the README.' : 'The server is missing the runtime or game files. See the README.', { error: true, ms: 6000 });
  }
  localStorageSet('ma-picks', JSON.stringify([...state.picks])); localStorageSet('ma-stages', JSON.stringify([...state.stagePicks]));
  const settings = { gameTime: +$('#gametime').value, hitPoints: +$('#hitpoints').value, gameSpeed: +$('#gamespeed').value, fullscreen: 1,
    cpu: $('#cpu').value, cpuLevel: $('#cpulevel').value, graphics: $('#graphics').value };
  localStorageSet('ma-rules', JSON.stringify({ gametime: $('#gametime').value, hitpoints: $('#hitpoints').value, gamespeed: $('#gamespeed').value, cpu: $('#cpu').value, cpulevel: $('#cpulevel').value, graphics: $('#graphics').value }));
  state.settings = settings;
  settings.p2 = settings.cpu !== 'off' && !seatOwner('p2') ? 'cpu' : 'human';
  const roster = await api('api/roster', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fighters: [...state.picks], stages: [...state.stagePicks], settings }) });
  if (state.iframe) state.iframe.remove();
  const f = h('iframe', { title: 'OpenMortal running in Boxedwine', allow: 'autoplay; gamepad; fullscreen', src: runtimeUrl(info.filesystemFile, roster.overlay) });
  $('#cabinet').prepend(f); state.iframe = f;
  $('#setup').hidden = true; $('#boot').hidden = false; $('#bootText').textContent = 'Booting...';
  state.running = true; state.sentControl = ''; state.game = null; blip('ok');
  renderSeats();
  state.ws && state.ws.send(JSON.stringify({ t: 'say', text: 'The cabinet is booting. Get ready.' }));
  f.addEventListener('load', () => { try { f.contentWindow.focus(); } catch {} });
}

addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.arcade !== 'status') return;
  const t = String(e.data.text || '').trim();
  $('#bootText').textContent = t;
  $('#boot').hidden = !t || !!e.data.running;
});

$('#power').onclick = powerOn;
$('#btnSetup').onclick = () => { $('#setup').hidden = false; loadLists(); };
$('#btnMenu').onclick = () => { press(null, 'back', true); setTimeout(() => press(null, 'back', false), 80); };
$('#btnSkip').onclick = () => { press(null, 'skip', true); setTimeout(() => press(null, 'skip', false), 80); };
$('#btnFull').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
// Esc opens the game's menu, but in full screen browsers use it to leave full screen. Where the
// browser allows it, keep Esc for the game (holding Esc still leaves full screen).
document.addEventListener('fullscreenchange', () => {
  const kb = navigator.keyboard;
  if (!kb || !kb.lock) return;
  if (document.fullscreenElement) kb.lock(['Escape']).catch(() => {}); else kb.unlock();
});

// ---------------------------------------------------------------------------
// Following the game: who plays Player 2, and the computer's fighter pick
// ---------------------------------------------------------------------------
function bridge() {
  try { return state.iframe && state.iframe.contentWindow && state.iframe.contentWindow.arcade; } catch { return null; }
}
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
function tap(slot, button) { press(slot, button, true, 'cpu'); setTimeout(() => press(slot, button, false, 'cpu'), 90); }

// On the select screen the computer still has to lock in a fighter for Player 2, through
// Player 2's keys like anybody else: a few random cursor steps, then a punch.
async function computerPicks() {
  state.picking = true; state.lastPick = Date.now();
  // stop the moment the game has moved on: a stray Player 2 key in the fight would count as
  // a person taking over
  const stillPicking = () => { const b = bridge(); const g = b && b.readState && b.readState(); return !!g && g.phase === 'select' && !g.p2picked && cpuPlaysP2(); };
  try {
    await sleepMs(600);
    const steps = 1 + Math.floor(Math.random() * 6);
    for (let i = 0; i < steps; i++) {
      if (!stillPicking()) return;
      tap('p2', ['right', 'down', 'left', 'up'][Math.floor(Math.random() * 4)]);
      await sleepMs(170);
    }
    await sleepMs(250);
    if (stillPicking()) tap('p2', 'lp');
  } finally { state.picking = false; state.lastPick = Date.now(); }
}

// Game speed: during fights the game reports its tick about once a second; at full speed it
// makes 1000 / (game speed setting) ticks a second. Below that, the emulator can't keep up.
const speed = { samples: [], shownAt: 0 };
function showSpeed(game) {
  const el = $('#speed');
  if (game.phase !== 'fight' || typeof game.tick !== 'number') {
    speed.samples = [];
    if (Date.now() - speed.shownAt > 8000) el.hidden = true;
    return;
  }
  const now = performance.now(), last = speed.samples[speed.samples.length - 1];
  if (last && game.tick < last.tick) speed.samples = [];        // a new round starts at tick 0
  if (!last || game.tick !== last.tick) speed.samples.push({ t: now, tick: game.tick });
  speed.samples = speed.samples.filter(s => now - s.t < 6000);
  if (speed.samples.length < 3) return;
  const a = speed.samples[0], z = speed.samples[speed.samples.length - 1];
  const perSecond = (z.tick - a.tick) / ((z.t - a.t) / 1000);
  const pct = Math.round(100 * perSecond / (1000 / (state.settings.gameSpeed || 12)));
  el.textContent = `Game speed ${Math.min(pct, 100)}%`;
  el.classList.toggle('slow', pct < 90 && pct >= 60);
  el.classList.toggle('bad', pct < 60);
  el.hidden = false; speed.shownAt = Date.now();
}

let seatShown = '';
function followGame() {
  const b = bridge();
  if (!state.running || !b || !b.readState) return;
  const game = b.readState();
  if (!game) return;   // the game is still starting
  if (!state.game && b.nudgeAudio) b.nudgeAudio();   // the game is up: make sure its sound is on
  state.game = game;
  showSpeed(game);
  const cpu = cpuPlaysP2();
  const level = state.settings.cpuLevel || 'normal';
  const want = `p2=${cpu ? 'cpu' : 'human'} level=${level}`;
  if (want !== state.sentControl && b.writeControl(`${want} seq=${++state.controlSeq}\n`)) state.sentControl = want;
  // the game shows the select screen, the human has picked, the computer hasn't yet
  if (cpu && game.phase === 'select' && game.cpu === 1 && game.p1picked && !game.p2picked && !state.picking && Date.now() - state.lastPick > 1800) computerPicks();
  // the computer lost: at "Continue?" it presses a button like a player would, so the winner
  // goes on to the next opponent instead of back to the main menu
  if (cpu && game.phase === 'judgement' && game.winner === 0 && state.continuedAt !== game.seq) {
    state.continuedAt = game.seq;
    setTimeout(() => { const g = bridge() && bridge().readState(); if (g && g.phase === 'judgement' && cpuPlaysP2()) tap('p2', 'lp'); }, 1500);
  }
  const shown = `${cpu}|${Date.now() - state.kbP2At < KEYBOARD_SEAT_MS}`;
  if (shown !== seatShown) { seatShown = shown; renderSeats(); }
}
setInterval(followGame, 250);

// clicks and key presses on the big screen also wake the game's sound (see runtime/arcade.html)
for (const type of ['pointerdown', 'keydown']) {
  addEventListener(type, () => { if (!state.running) return; const b = bridge(); if (b && b.nudgeAudio) b.nudgeAudio(); }, true);
}

// the rules last used on this computer
try {
  const r = JSON.parse(localStorageGet('ma-rules') || 'null');
  if (r) for (const [id, v] of Object.entries(r)) { const el = $('#' + id); if (el && [...el.options].some(o => o.value === v)) el.value = v; }
} catch {}

api('api/info').then(i => { state.info = i; if (!i.filesystem) $('#powerNote').textContent = 'Missing: public/game/TinyCore15Wine11.0-web.zip (the Boxedwine Windows file system). See the README.'; }).catch(() => {});
connect();
loadLists();
renderSeats();
