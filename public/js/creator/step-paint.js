// step-paint.js - Step 3: Mario Paint-style drawing on frames + the special move's projectile.
import { h, toast, blip, put } from '../ui.js';
import { composite } from './cutout.js';
import { poseFromGroup } from './step-cutout.js';

export const PALETTE = ['#f8f8f8', '#a8a8a8', '#585858', '#101010', '#a81000', '#f83800', '#f87858', '#fca044',
  '#f8b800', '#f8f878', '#58d854', '#00a800', '#3cbcfc', '#0058f8', '#6844fc', '#d800cc'];

// 16x16 stamps, drawn as text so they stay editable. Letters index PALETTE: a=0 ... p=15, '.' = clear.
export const STAMPS = {
  burst: ['.......j........', '......jj........', '..j...jjj...j...', '...jj.jjjj.jj...', '...jjjjjjjjj....', '....jjjjjjjj.jj.', 'jjjjjjjjjjjjjj..', '..jjjjjjjjjjj...',
    '...jjjjjjjjjjjj.', '..jjjjjjjjjj....', '.jj.jjjjjjjj....', '....jjj.jjjjj...', '...jj..jj..jj...', '..j.....j...j...', '........j.......', '................'],
  flame: ['.......f........', '......ff........', '......fff.......', '.....ffff...f...', '....fffhff..f...', '....ffhhfff.ff..', '...ffhhhhfffff..', '...fhhiihhffff..',
    '..ffhiiiihhfff..', '..fhhiiiiihhff..', '..fhiiijiiihff..', '..fhiijjjiihff..', '..ffhijjjihhff..', '...fhhiiihhff...', '....ffhhhfff....', '......ffff......'],
  bolt: ['........ii......', '.......iii......', '......iii.......', '.....iii........', '....iiii........', '...iiiiiiii.....', '......iiii......', '.....iiii.......',
    '....iii.........', '...iiiiiiiii....', '.......iiii.....', '......iii.......', '.....ii.........', '....ii..........', '...i............', '................'],
  star: ['.......i........', '.......i........', '......iii.......', '......iii.......', 'iiiiiiijiiiiiii.', '.iiiiijjjiiiii..', '...iiiijiiii....', '....iiiiiii.....',
    '....iiiiiii.....', '...iiii.iiii....', '...iii...iii....', '..iii.....iii...', '..ii.......ii...', '.i...........i..', '................', '................'],
  heart: ['................', '..ffff...ffff...', '.ffffff.ffffff..', 'ffgaffffffffff..', 'ffaffffffffffff.', 'fffffffffffffff.', 'fffffffffffffff.', '.fffffffffffff..',
    '..fffffffffff...', '...fffffffff....', '....fffffff.....', '.....fffff......', '......fff.......', '.......f........', '................', '................'],
  skull: ['....aaaaaaa.....', '...aaaaaaaaa....', '..aaaaaaaaaaa...', '..aaaaaaaaaaa...', '..aaddaaaddaa...', '..addddadddda...', '..addddadddda...', '..aaddaaaddaa...',
    '..aaaaadaaaaa...', '...aaaddaaaa....', '....aaaaaaa.....', '....adadada.....', '....aaaaaaa.....', '.....aaaaa......', '................', '................'],
};

let tool = 'brush', color = 5, size = 4, stampName = 'burst', onion = true, target = 'frames', projFrame = 0;
const history = [];

const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

export function unmount() {}

export function mount(ctx) {
  poseFromGroup(ctx);
  tools(ctx);
  if (target === 'projectile') return projectileEditor(ctx);
  const clip = ctx.clip();
  if (!clip) {
    put(ctx.el.viewport, h('div', { class: 'empty' }, h('h1', { class: 'title' }, 'Nothing to paint on yet'), h('p', { class: 'dim' }, 'Film this pose first, or switch to drawing your projectile.'),
      h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'slab', onclick: () => ctx.go('footage') }, 'Go to footage'), h('button', { class: 'slab', onclick: () => { target = 'projectile'; ctx.refresh(); } }, 'Draw the projectile'))));
    ctx.refreshFilm(); return;
  }
  frameEditor(ctx, clip);
}

// ---------------------------------------------------------------------------
function tools(ctx) {
  const T = ctx.el.tools;
  const pal = h('div', { class: 'palette', role: 'group', 'aria-label': 'Colours' }, PALETTE.map((c, i) =>
    h('button', { style: { background: c }, 'aria-pressed': String(i === color && tool !== 'eraser'), 'aria-label': `Colour ${i + 1}`, onclick: () => { color = i; if (tool === 'eraser') tool = 'brush'; ctx.refresh(); } })));
  const toolBtn = (id, label, icon) => h('button', { class: 'slab small', 'aria-pressed': String(tool === id), title: label, 'aria-label': label, onclick: () => { tool = id; ctx.refresh(); } }, icon);
  const ico = path => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.innerHTML = path; return s; };
  put(T, 
    h('div', { class: 'seg', role: 'group', 'aria-label': 'What to paint', style: { marginBottom: '6px' } },
      h('button', { 'aria-pressed': String(target === 'frames'), onclick: () => { target = 'frames'; ctx.refresh(); } }, 'Effects on frames'),
      h('button', { 'aria-pressed': String(target === 'projectile'), onclick: () => { target = 'projectile'; ctx.refresh(); } }, 'Projectile')),
    h('h2', {}, target === 'projectile' ? 'Draw your projectile' : 'Paint effects'),
    h('p', { class: 'small dim' }, target === 'projectile' ? 'Four frames that loop while it flies. Leave it empty if your special move is a strike.' : 'Fire, sparks, speed lines, a hat. Paint lands on top of you and goes into the game.'),
    pal,
    h('div', { class: 'tools', style: { marginTop: '8px' } },
      toolBtn('pencil', 'Pencil', ico('<path d="M2 14l1-4 7-7 3 3-7 7z" fill="#efe3c8"/><path d="M2 14l1-4 3 3z" fill="#e3a93a"/>')),
      toolBtn('brush', 'Brush', ico('<rect x="3" y="3" width="10" height="10" fill="#efe3c8"/>')),
      toolBtn('spray', 'Spray', ico('<g fill="#efe3c8"><rect x="2" y="3" width="2" height="2"/><rect x="7" y="2" width="2" height="2"/><rect x="11" y="5" width="2" height="2"/><rect x="4" y="8" width="2" height="2"/><rect x="9" y="9" width="2" height="2"/><rect x="5" y="12" width="2" height="2"/><rect x="12" y="11" width="2" height="2"/></g>')),
      toolBtn('line', 'Line', ico('<path d="M2 13L13 2" stroke="#efe3c8" stroke-width="2"/>')),
      toolBtn('fill', 'Fill', ico('<path d="M3 7l5-5 5 5-5 5z" fill="#efe3c8"/><rect x="12" y="10" width="2" height="4" fill="#3cbcfc"/>')),
      toolBtn('stamp', 'Stamp', ico('<path d="M8 1l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5z" fill="#f8b800"/>')),
      toolBtn('eraser', 'Eraser', ico('<rect x="2" y="6" width="12" height="6" fill="#f87858"/><rect x="2" y="6" width="4" height="6" fill="#efe3c8"/>')),
      h('button', { class: 'slab small', title: 'Undo', 'aria-label': 'Undo', onclick: () => undoPaint(ctx) }, ico('<path d="M6 3L2 7l4 4V8h4a3 3 0 010 6H8v2h2a5 5 0 000-10H6z" fill="#efe3c8"/>'))),
    tool === 'stamp' ? h('div', { class: 'stamps', style: { marginTop: '6px' } }, Object.keys(STAMPS).map(n => {
      const c = stampCanvas(n); return h('button', { class: 'slab small', 'aria-pressed': String(stampName === n), 'aria-label': n, onclick: () => { stampName = n; ctx.refresh(); } }, c);
    })) : null,
    h('label', { class: 'field', style: { marginTop: '6px' } }, tool === 'stamp' ? 'Stamp size' : 'Brush size', h('input', { type: 'range', min: 1, max: 16, value: size, oninput: e => (size = +e.target.value) })),
  );
  if (target === 'frames') {
    put(T, 
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: onion, onchange: e => { onion = e.target.checked; ctx.refresh(); } }), 'Show the previous frame faintly (onion skin)'),
      h('div', { class: 'row', style: { marginTop: '6px' } },
        h('button', { class: 'slab small', onclick: () => copyToAll(ctx) }, 'Copy to every frame'),
        h('button', { class: 'slab small', onclick: () => { const c = ctx.clip(); if (!c) return; snapshot(c); c.paint[curFrame(ctx, c)] = null; ctx.touch(c); ctx.refresh(); } }, 'Clear this frame')),
      h('p', { class: 'small dim' }, 'Tip: paint a spark on the frame where your punch lands, then flip through frames to animate a trail.'));
  } else {
    const P = ctx.p.projectile;
    put(T, 
      h('h3', {}, 'How it flies'),
      h('label', { class: 'field' }, 'Speed', h('input', { type: 'range', min: 16, max: 80, value: P.speed, oninput: e => { P.speed = +e.target.value; ctx.markDirty(); } })),
      h('label', { class: 'field' }, 'Arc (0 = straight)', h('input', { type: 'range', min: 0, max: 30, value: P.lift || 0, oninput: e => { P.lift = +e.target.value; P.gravity = P.lift ? 2 : 0; ctx.markDirty(); } })),
      h('div', { class: 'row', style: { marginTop: '6px' } },
        h('button', { class: 'slab small', onclick: () => { const f = P.frames[projFrame]; if (!f) return; for (let k = 0; k < 4; k++) if (k !== projFrame) P.frames[k] = new ImageData(new Uint8ClampedArray(f.data), f.width, f.height); ctx.markDirty(); ctx.refresh(); } }, 'Copy to all 4 frames'),
        h('button', { class: 'slab small', onclick: () => { P.frames = []; ctx.markDirty(); ctx.refresh(); } }, 'Erase projectile')));
  }
}

export function stampCanvas(n) {
  const rows = STAMPS[n]; const c = document.createElement('canvas'); c.width = 16; c.height = 16; const x = c.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, xx) => { if (ch === '.') return; x.fillStyle = PALETTE[ch.charCodeAt(0) - 97]; x.fillRect(xx, y, 1, 1); }));
  return c;
}

// ---------------------------------------------------------------------------
// Raster ops on an ImageData paint layer (no anti-aliasing: crisp 16-bit pixels)
// ---------------------------------------------------------------------------
export function plot(img, x, y, rgb, erase) {
  x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  if (erase) { img.data[o + 3] = 0; return; }
  img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
}
export function disc(img, cx, cy, r, rgb, erase) {
  if (r <= 1) return plot(img, cx, cy, rgb, erase);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) plot(img, cx + x, cy + y, rgb, erase);
}
function segment(img, a, b, fn) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= n; i++) fn(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n);
}
export function stampAt(img, cx, cy, name, scale) {
  const rows = STAMPS[name]; const s = Math.max(1, Math.round(scale / 2));
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === '.') return; const rgb = hex(PALETTE[ch.charCodeAt(0) - 97]);
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) plot(img, cx + (x - 8) * s + dx, cy + (y - 8) * s + dy, rgb);
  }));
}
export function flood(img, sx, sy, rgb) {
  sx = Math.round(sx); sy = Math.round(sy);
  const W = img.width, H = img.height, d = img.data; const at = (x, y) => (y * W + x) * 4;
  const t = at(sx, sy); const tr = d[t], tg = d[t + 1], tb = d[t + 2], ta = d[t + 3];
  if (ta && tr === rgb[0] && tg === rgb[1] && tb === rgb[2]) return;
  const same = o => (ta === 0 ? d[o + 3] === 0 : d[o + 3] !== 0 && d[o] === tr && d[o + 1] === tg && d[o + 2] === tb);
  const stack = [[sx, sy]]; let guard = W * H;
  while (stack.length && guard-- > 0) {
    const [x, y] = stack.pop(); if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const o = at(x, y); if (!same(o)) continue;
    d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

function snapshot(clip, frame = null) {
  history.push({ clip, paint: clip.paint.map(p => p && new ImageData(new Uint8ClampedArray(p.data), p.width, p.height)) });
  if (history.length > 30) history.shift();
}
function undoPaint(ctx) {
  const u = history.pop(); if (!u) return toast('Nothing to undo.');
  if (u.clip === 'projectile') ctx.p.projectile.frames = u.paint; else { u.clip.paint = u.paint; ctx.touch(u.clip); }
  ctx.refresh();
}
const curFrame = (ctx, clip) => Math.min(ctx.sel.frame, clip.frames.length - 1);

function copyToAll(ctx) {
  const clip = ctx.clip(); if (!clip) return; const i = curFrame(ctx, clip); const src = clip.paint[i];
  if (!src) return toast('Paint something on this frame first.');
  snapshot(clip);
  clip.paint = clip.paint.map((p, k) => {
    if (k === i) return p;
    const out = p ? new ImageData(new Uint8ClampedArray(p.data), p.width, p.height) : new ImageData(src.width, src.height);
    for (let o = 0; o < src.data.length; o += 4) if (src.data[o + 3]) { out.data[o] = src.data[o]; out.data[o + 1] = src.data[o + 1]; out.data[o + 2] = src.data[o + 2]; out.data[o + 3] = 255; }
    return out;
  });
  ctx.touch(clip); toast('Copied to every frame of this pose.'); ctx.refresh();
}

// ---------------------------------------------------------------------------
// Shared drawing surface
// ---------------------------------------------------------------------------
function surface({ W, H, base, layer, under, zoom = 1, onCommit }) {
  const cv = h('canvas', { style: { touchAction: 'none', cursor: 'crosshair', width: zoom > 1 ? `${W * zoom}px` : null } }); cv.width = W; cv.height = H;
  const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
  const lc = document.createElement('canvas'); lc.width = W; lc.height = H; const lx = lc.getContext('2d');
  let start = null, last = null, drawing = false, preview = null;
  const redraw = () => {
    x.clearRect(0, 0, W, H);
    if (base) base(x);
    if (under) { x.globalAlpha = 0.3; x.drawImage(under, 0, 0); x.globalAlpha = 1; }
    lx.putImageData(layer, 0, 0); x.drawImage(lc, 0, 0);
    if (preview) { x.strokeStyle = PALETTE[color]; x.lineWidth = Math.max(1, size); x.beginPath(); x.moveTo(preview[0].x, preview[0].y); x.lineTo(preview[1].x, preview[1].y); x.stroke(); }
  };
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  const rgb = () => hex(PALETTE[color]); const erase = () => tool === 'eraser';
  const r = () => (tool === 'pencil' ? 0 : Math.max(1, Math.round(size / 2)));
  const spray = p => { for (let k = 0; k < 6 + size; k++) { const a = Math.random() * Math.PI * 2, d = Math.random() * (size * 2 + 4); plot(layer, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, rgb()); } };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); const p = pos(e); drawing = true; start = last = p;
    onCommit('before');
    if (tool === 'fill') { flood(layer, p.x, p.y, rgb()); drawing = false; onCommit('after'); redraw(); return; }
    if (tool === 'stamp') { stampAt(layer, p.x, p.y, stampName, size); drawing = false; blip('move'); onCommit('after'); redraw(); return; }
    if (tool === 'spray') spray(p); else if (tool !== 'line') disc(layer, p.x, p.y, r(), rgb(), erase());
    redraw();
  });
  cv.addEventListener('pointermove', e => {
    if (!drawing) return; const p = pos(e);
    if (tool === 'line') { preview = [start, p]; redraw(); return; }
    if (tool === 'spray') spray(p); else segment(layer, last, p, (xx, yy) => disc(layer, xx, yy, r(), rgb(), erase()));
    last = p; redraw();
  });
  const up = e => {
    if (!drawing) return; drawing = false;
    if (tool === 'line') { const p = pos(e); segment(layer, start, p, (xx, yy) => disc(layer, xx, yy, r(), rgb(), false)); preview = null; }
    onCommit('after'); redraw();
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  redraw();
  return { el: cv, redraw };
}

function frameEditor(ctx, clip) {
  const i = curFrame(ctx, clip);
  const W = clip.w, H = clip.h;
  if (!clip.paint[i]) clip.paint[i] = new ImageData(W, H);
  const layer = clip.paint[i];
  // base = cutout without paint, over a stage
  const stage = Object.assign(new Image(), { src: 'img/stages/level1.jpg' });
  const saved = clip.paint[i]; clip.paint[i] = null;
  const baseImg = composite(clip, i); clip.paint[i] = saved;
  const bc = document.createElement('canvas'); bc.width = W; bc.height = H; bc.getContext('2d').putImageData(baseImg, 0, 0);
  let under = null;
  if (onion && i > 0 && clip.paint[i - 1]) { under = document.createElement('canvas'); under.width = W; under.height = H; under.getContext('2d').putImageData(clip.paint[i - 1], 0, 0); }
  const s = surface({
    W, H, layer, under,
    base: x => { if (stage.complete && stage.naturalWidth) x.drawImage(stage, 0, 0, W, H); else { x.fillStyle = '#2f2722'; x.fillRect(0, 0, W, H); } x.drawImage(bc, 0, 0); },
    onCommit: phase => { if (phase === 'before') snapshot(clip); else { ctx.touch(clip); } },
  });
  stage.onload = () => s.redraw();
  const nav = d => { ctx.sel.frame = (i + d + clip.frames.length) % clip.frames.length; ctx.el.viewport.innerHTML = ''; frameEditor(ctx, clip); ctx.refreshFilm({ onPick }); };
  const onPick = k => { ctx.sel.frame = k; ctx.el.viewport.innerHTML = ''; frameEditor(ctx, clip); };
  put(ctx.el.viewport, h('div', { class: 'preview-wrap' }, h('div', { class: 'screen' }, s.el),
    h('div', { class: 'row' }, h('button', { class: 'slab small', onclick: () => nav(-1) }, 'Previous frame'), h('span', { class: 'dim' }, `${clip.name}, frame ${i + 1} of ${clip.frames.length}`),
      h('button', { class: 'slab small', onclick: () => nav(1) }, 'Next frame'), h('button', { class: 'slab small brass', onclick: () => ctx.go('profile') }, 'On to the profile'))));
  ctx.refreshFilm({ onPick });
}

function projectileEditor(ctx) {
  const P = ctx.p.projectile; const W = P.w, H = P.h;
  for (let k = 0; k < 4; k++) if (!P.frames[k]) P.frames[k] = new ImageData(W, H);
  const layer = P.frames[projFrame];
  const under = projFrame > 0 ? (() => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(P.frames[projFrame - 1], 0, 0); return c; })() : null;
  const s = surface({
    W, H, layer, under, zoom: 6,
    base: x => { for (let y = 0; y < H; y += 8) for (let xx = 0; xx < W; xx += 8) { x.fillStyle = ((xx + y) / 8) % 2 ? '#4a3f37' : '#2f2722'; x.fillRect(xx, y, 8, 8); } },
    onCommit: phase => { if (phase === 'before') { history.push({ clip: 'projectile', paint: P.frames.map(f => f && new ImageData(new Uint8ClampedArray(f.data), f.width, f.height)) }); } else { ctx.markDirty(); thumbs(); } },
  });
  const strip = h('div', { class: 'proj', style: { width: '320px' } });
  const thumbs = () => {
    strip.innerHTML = '';
    P.frames.forEach((f, k) => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(f, 0, 0);
      strip.append(h('button', { 'aria-current': String(k === projFrame), 'aria-label': `Projectile frame ${k + 1}`, onclick: () => { projFrame = k; ctx.refresh(); } }, c)); });
  };
  thumbs();
  // flying preview
  const fly = h('canvas', { style: { width: '320px', height: '80px', background: '#120d0b' } }); fly.width = 320; fly.height = 80; const fx = fly.getContext('2d'); fx.imageSmoothingEnabled = false;
  let t = 0; const tmpc = document.createElement('canvas'); tmpc.width = W; tmpc.height = H;
  const iv = setInterval(() => {
    if (!fly.isConnected) return clearInterval(iv);
    t += 1; const x = (t * P.speed / 8) % 380 - 60; const k = Math.floor(t / 4) % 4;
    const lift = P.lift || 0; const y = 8 + Math.max(-20, (t * P.speed / 8 % 380) * 0) + (lift ? (((x + 60) / 380) ** 2 * 60 - lift) : 0);
    fx.clearRect(0, 0, 320, 80); tmpc.getContext('2d').putImageData(P.frames[k], 0, 0); fx.drawImage(tmpc, x, Math.max(0, Math.min(16, y)), 48, 48);
  }, 40);
  put(ctx.el.viewport, h('div', { class: 'preview-wrap' }, h('div', { class: 'screen' }, s.el), strip, fly, h('p', { class: 'dim small' }, 'It spawns from your hand on the frame where your special move reaches furthest.')));
  ctx.el.film.innerHTML = ''; put(ctx.el.film, h('span', { class: 'hint' }, 'Projectile frames loop in the order shown above.'));
}
