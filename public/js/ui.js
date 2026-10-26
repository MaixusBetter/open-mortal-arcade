// ui.js - small shared helpers for every Mortal Arcade screen.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

let toastTimer = 0;
export function toast(msg, { error = false, ms = 3200 } = {}) {
  let t = $('.toast');
  if (!t) { t = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg; t.classList.toggle('error', error); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---- 16-bit menu blips (square waves, quiet). Only after a user gesture. ----
let actx = null;
export function blip(kind = 'move') {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square';
    const t = actx.currentTime;
    const f = { move: [440, 660], ok: [523, 1046], back: [330, 220], hit: [110, 70] }[kind] || [440, 660];
    o.frequency.setValueAtTime(f[0], t); o.frequency.setValueAtTime(f[1], t + 0.045);
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.13);
  } catch {}
}

/** Arrow-key navigation for a vertical list of focusable items. */
export function menuNav(container, selector = 'a, button') {
  container.addEventListener('keydown', e => {
    const items = $$(selector, container).filter(el => !el.disabled && el.offsetParent);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      n && n.focus(); blip('move');
    }
  });
}

/** Plays an attract sprite strip (from tools/extract-attract.mjs) on a canvas. */
export async function attractSprite(canvas, name, { mirror = false, scale = 1, fps = 7 } = {}) {
  const manifest = await (await fetch('img/attract.json')).json();
  const m = manifest[name];
  const img = new Image(); img.src = `img/attract-${name}.png`; await img.decode();
  canvas.width = m.w; canvas.height = m.h;
  if (scale) { canvas.style.width = m.w * scale + 'px'; canvas.style.height = m.h * scale + 'px'; }
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  let f = 0, dir = 1;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = () => {
    ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? m.w : 0, 0);
    ctx.clearRect(0, 0, m.w, m.h);
    ctx.drawImage(img, f * m.w, 0, m.w, m.h, 0, 0, m.w, m.h);
  };
  draw();
  if (reduce) return;
  setInterval(() => { f += dir; if (f >= m.frames - 1 || f <= 0) dir = -dir; draw(); }, 1000 / fps);
}

export async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json() : await r.arrayBuffer();
  if (!r.ok) throw new Error((body && body.error) || `Request failed (${r.status})`);
  return body;
}

export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** element.append that skips null/false (for conditional children) */
export function put(el, ...kids) { el.append(...kids.flat().filter(k => k != null && k !== false)); return el; }
