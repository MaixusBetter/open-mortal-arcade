// pad.js - phone / laptop controller. Sends logical buttons to the big screen.
import { $, $$ } from './ui.js';
import { GamepadPoller, PAD_BUTTONS } from './controls.js';

const params = new URLSearchParams(location.search);
let ws = null, slot = null, connected = false, wantClose = false;
const held = new Set();

$('#code').value = (params.get('code') || '').toUpperCase();
try { $('#name').value = localStorage.getItem('ma-name') || ''; } catch {}
if (!$('#code').value) $('#code').focus(); else $('#name').focus();

function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function setButton(k, down) {
  if (down === held.has(k)) return;
  if (down) held.add(k); else held.delete(k);
  send({ t: 'in', k, d: down ? 1 : 0 });
  if (down && navigator.vibrate) { try { navigator.vibrate(8); } catch {} }
}
function releaseAll() { for (const k of [...held]) setButton(k, false); }

function join() {
  const code = $('#code').value.trim().toUpperCase();
  const name = $('#name').value.trim() || 'Player';
  if (!/^[A-Z]{4}$/.test(code)) { $('#err').textContent = 'The room code is the 4 letters on the big screen.'; return; }
  try { localStorage.setItem('ma-name', name); } catch {}
  $('#err').textContent = 'Connecting...';
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => send({ t: 'join', code, name, device: matchMedia('(pointer: coarse)').matches ? 'phone' : 'laptop', slot: params.get('slot') || 'auto' });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'error') { $('#err').textContent = m.error; showJoin(); wantClose = true; ws.close(); }
    else if (m.t === 'slot') {
      connected = true; slot = m.slot;
      $('#joinView').hidden = true; $('#padView').hidden = false; $('#err').textContent = '';
      const chip = $('#slot'); chip.className = 'slotchip ' + (slot === 'wait' ? '' : slot);
      chip.textContent = slot === 'wait' ? 'Next up' : `Player ${slot.slice(1)}`;
      $('#me').textContent = name;
      if (slot === 'wait') say('Both seats are taken. You are in the queue.');
      tryLandscape();
    } else if (m.t === 'say') { say(m.text); if (m.rumble && navigator.vibrate) navigator.vibrate([30, 40, 30]); }
  };
  ws.onclose = () => {
    releaseAll(); held.clear();
    if (wantClose) { wantClose = false; return; }
    if (connected) { say('Connection lost. Reconnecting...'); setTimeout(join, 1200); }
    else $('#err').textContent = 'Could not reach the arcade server. Are you on the same Wi-Fi as the big screen?';
  };
}
function showJoin() { $('#joinView').hidden = false; $('#padView').hidden = true; }

let sayTimer = 0;
function say(text) { const m = $('#msg'); m.textContent = text; m.hidden = false; clearTimeout(sayTimer); sayTimer = setTimeout(() => (m.hidden = true), 3500); }

function tryLandscape() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
}

$('#joinBtn').onclick = join;
for (const id of ['#code', '#name']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

// ---------------------------------------------------------------------------
// Touch: every pointer tracks the control under it, so thumbs can slide.
// ---------------------------------------------------------------------------
const dpad = $('#dpad');
const pointers = new Map();   // pointerId -> Set(buttons)

function controlsAt(x, y) {
  const r = dpad.getBoundingClientRect();
  if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
    const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
    const dead = r.width * 0.12, out = new Set();
    if (Math.hypot(dx, dy) < dead) return out;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;   // 8-way with generous diagonals
    if (ang > -157.5 && ang < -22.5) out.add('up');
    if (ang > 22.5 && ang < 157.5) out.add('down');
    if (ang > 112.5 || ang < -112.5) out.add('left');
    if (ang > -67.5 && ang < 67.5) out.add('right');
    return out;
  }
  const el = document.elementFromPoint(x, y);
  const b = el && el.closest('[data-btn]');
  return new Set(b ? [b.dataset.btn] : []);
}

function sync() {
  const want = new Set(); for (const s of pointers.values()) for (const b of s) want.add(b);
  for (const k of [...held]) if (!want.has(k) && !kbHeld.has(k) && !gpHeld.has(k)) setButton(k, false);
  for (const k of want) setButton(k, true);
  for (const d of ['up', 'down', 'left', 'right']) dpad.classList.toggle('on-' + d, held.has(d));
  $$('[data-btn]').forEach(b => b.classList.toggle('down', held.has(b.dataset.btn)));
}

const deckArea = $('#padView');
deckArea.addEventListener('pointerdown', e => {
  if (e.target.closest('.bar')) {
    const b = e.target.closest('[data-btn]'); if (!b) return;
    e.preventDefault(); setButton(b.dataset.btn, true); b.setPointerCapture(e.pointerId);
    const up = () => { setButton(b.dataset.btn, false); b.removeEventListener('pointerup', up); b.removeEventListener('pointercancel', up); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    return;
  }
  e.preventDefault(); deckArea.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, controlsAt(e.clientX, e.clientY)); sync();
});
deckArea.addEventListener('pointermove', e => { if (!pointers.has(e.pointerId)) return; pointers.set(e.pointerId, controlsAt(e.clientX, e.clientY)); sync(); });
const lift = e => { if (pointers.delete(e.pointerId)) sync(); };
deckArea.addEventListener('pointerup', lift); deckArea.addEventListener('pointercancel', lift);
addEventListener('blur', () => { pointers.clear(); kbHeld.clear(); gpHeld.clear(); releaseAll(); sync(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { pointers.clear(); releaseAll(); } });

// ---------------------------------------------------------------------------
// Laptop keyboard + local gamepad
// ---------------------------------------------------------------------------
const KB = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  KeyJ: 'lp', KeyU: 'hp', KeyK: 'lk', KeyI: 'hk', KeyL: 'block', Space: 'block', Enter: 'start', Escape: 'back',
};
const kbHeld = new Set();
addEventListener('keydown', e => {
  if ($('#padView').hidden) return;
  const k = KB[e.code]; if (!k) return; e.preventDefault(); if (e.repeat) return;
  kbHeld.add(k); setButton(k, true); sync();
});
addEventListener('keyup', e => { const k = KB[e.code]; if (!k) return; kbHeld.delete(k); if (![...pointers.values()].some(s => s.has(k))) setButton(k, false); sync(); });

const gpHeld = new Set();
if (window.isSecureContext && navigator.getGamepads) {
  new GamepadPoller((i, b, down) => {
    if ($('#padView').hidden || !Object.values(PAD_BUTTONS).includes(b) || b === 'skip') return;
    if (down) gpHeld.add(b); else gpHeld.delete(b);
    setButton(b, down); sync();
  }).start();
}

// keep the connection warm on phones that throttle idle sockets
setInterval(() => send({ t: 'ping', at: Date.now() }), 15000);
