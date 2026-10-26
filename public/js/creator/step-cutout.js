// step-cutout.js - Step 2: automatic background removal + brush touch-ups (+ anchor lines in Hands-on).
import { h, toast, blip, put } from '../ui.js';
import { POSES, resolveGroups } from './state.js';
import { cutClip, composite, withEdits, anchorFromMask, analyzeBorder } from './cutout.js';
import { methodName } from './step-footage.js';

const METHODS = [
  ['auto', 'Automatic (recommended)'],
  ['ai', 'AI person cutout'],
  ['aikey', 'AI + green/blue screen cleanup'],
  ['key', 'Green/blue screen only'],
  ['aiplate', 'AI + empty-background shot (camera)'],
  ['plate', 'Empty-background shot only'],
  ['alpha', 'Already transparent (GIF/PNG)'],
];
const BACKDROPS = [['checker', 'Checkerboard'], ['level1', 'Budapest'], ['level5', 'Stage 5'], ['level8', 'Stage 8'], ['black', 'Black'], ['white', 'White']];

let brush = { mode: 'remove', size: 14, all: false };
let backdrop = 'checker';
let showMaskTint = true;
let undo = [];

export function unmount() {}

export function poseFromGroup(ctx) {
  if (ctx.sel.kind !== 'group') return;
  const r = (resolveGroups(ctx.p)[ctx.sel.group] || [])[ctx.sel.frame] || (resolveGroups(ctx.p)[ctx.sel.group] || [])[0];
  const pose = r && Object.keys(ctx.p.poses).find(k => ctx.p.poses[k] === r.clip);
  if (pose) { ctx.sel.kind = 'pose'; ctx.sel.pose = pose; ctx.sel.frame = r.index; ctx.refreshMoves(); }
}

export function mount(ctx) {
  poseFromGroup(ctx);
  const clip = ctx.clip();
  tools(ctx, clip);
  if (!clip) {
    put(ctx.el.viewport, h('div', { class: 'empty' }, h('h1', { class: 'title' }, 'Nothing to cut out yet'), h('p', { class: 'dim' }, 'Film or upload this pose in step 1 first.'),
      h('button', { class: 'slab', onclick: () => ctx.go('footage') }, 'Go to footage')));
    ctx.refreshFilm(); return;
  }
  editor(ctx, clip);
}

function tools(ctx, clip) {
  const T = ctx.el.tools; const cut = ctx.p.cut;
  const method = h('select', { onchange: e => { cut.method = e.target.value; ctx.markDirty(); } }, METHODS.map(([v, l]) => h('option', { value: v, selected: cut.method === v }, l)));
  const sens = h('input', { type: 'range', min: 0, max: 100, value: cut.sensitivity, oninput: e => { cut.sensitivity = +e.target.value; sensOut.textContent = e.target.value; } });
  const sensOut = h('output', {}, cut.sensitivity);
  const rerun = async all => {
    const clips = all ? POSES.map(p => ctx.p.clips[ctx.p.poses[p.id]]).filter(Boolean) : [clip].filter(Boolean);
    for (const c of clips) {
      ctx.busy(`Cutting out ${c.name}...`, 0);
      try { await cutClip(c, ctx.p, { onProgress: v => ctx.busy(`Cutting out ${c.name}...`, v) }); } catch (e) { toast(e.message, { error: true }); }
      ctx.touch(c);
    }
    ctx.busy(null); blip('ok'); ctx.refresh();
  };
  put(T, 
    h('h2', {}, 'Cut out the background'),
    clip ? h('p', { class: 'small dim' }, `This pose used ${methodName(clip.method)}.`) : null,
    h('label', { class: 'field' }, 'Method', method),
    h('label', { class: 'field' }, h('span', {}, 'Sensitivity ', sensOut), sens),
    h('p', { class: 'small dim' }, 'Higher keeps more of you (and more background). Lower trims harder.'),
    h('div', { class: 'row' },
      h('button', { class: 'slab small blood', disabled: !clip, onclick: () => rerun(false) }, 'Redo this pose'),
      h('button', { class: 'slab small', onclick: () => rerun(true) }, 'Redo every pose')),
    h('button', { class: 'slab small', style: { marginTop: '6px' }, disabled: !clip, onclick: () => { pickKey = true; toast('Click the backdrop colour in the picture.'); } }, 'Pick the backdrop colour'),
    cut.keyColor ? h('p', { class: 'small dim' }, 'Backdrop colour ', h('i', { style: { display: 'inline-block', width: '14px', height: '14px', background: `rgb(${cut.keyColor})`, verticalAlign: '-2px' } }), ' ', h('a', { href: '#', onclick: e => { e.preventDefault(); cut.keyColor = null; ctx.refresh(); } }, 'detect automatically')) : null,
    h('h3', {}, 'Touch up by hand'),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Brush' },
      h('button', { 'aria-pressed': String(brush.mode === 'keep'), onclick: e => { brush.mode = 'keep'; ctx.refresh(); } }, 'Keep'),
      h('button', { 'aria-pressed': String(brush.mode === 'remove'), onclick: e => { brush.mode = 'remove'; ctx.refresh(); } }, 'Remove'),
      h('button', { 'aria-pressed': String(brush.mode === 'reset'), onclick: e => { brush.mode = 'reset'; ctx.refresh(); } }, 'Undo brush')),
    h('label', { class: 'field', style: { marginTop: '6px' } }, 'Brush size', h('input', { type: 'range', min: 2, max: 60, value: brush.size, oninput: e => (brush.size = +e.target.value) })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: brush.all, onchange: e => (brush.all = e.target.checked) }), 'Paint on every frame of this pose'),
    h('p', { class: 'small dim' }, 'Handy for a lamp or door frame that never moves. Your brush strokes stay when you redo the automatic cutout.'),
    h('div', { class: 'row' },
      h('button', { class: 'slab small', onclick: () => doUndo(ctx) }, 'Undo stroke'),
      clip ? h('button', { class: 'slab small', onclick: () => { clip.edits = clip.edits.map(() => null); ctx.touch(clip); ctx.refresh(); } }, 'Clear all strokes') : null),
    h('h3', {}, 'View'),
    h('label', { class: 'field' }, 'Behind the fighter', h('select', { onchange: e => { backdrop = e.target.value; ctx.refresh(); } }, BACKDROPS.map(([v, l]) => h('option', { value: v, selected: backdrop === v }, l)))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: showMaskTint, onchange: e => { showMaskTint = e.target.checked; ctx.refresh(); } }), 'Show removed parts in red'),
  );
  if (ctx.mode === 'pro' && clip) {
    const a = clip.anchor || autoAnchor(clip);
    const sc = ctx.p.scale || 0;
    put(T, h('h3', {}, 'Anchor and size'),
      h('p', { class: 'small dim' }, 'The yellow line is the floor (where your feet are), the cyan line your centre. Drag them in the picture. Every frame of this pose is placed in the game relative to them.'),
      h('div', { class: 'row' },
        h('button', { class: 'slab small', onclick: () => { clip.anchor = null; ctx.markDirty(); ctx.refresh(); } }, 'Detect again'),
        h('span', { class: 'small dim' }, `floor y=${Math.round(a.y)}, centre x=${Math.round(a.x)}`)),
      h('label', { class: 'field' }, 'Fighter height in the game (px)', h('input', { type: 'number', min: 180, max: 420, value: sc ? Math.round(sc * stanceHeight(ctx)) : 300, onchange: e => { const sh = stanceHeight(ctx); ctx.p.scale = sh ? +e.target.value / sh : null; ctx.markDirty(); } })),
      h('p', { class: 'small dim' }, 'Stock fighters are about 300 px tall on the 640x480 screen.'));
  }
}

export function autoAnchor(clip) {
  const m = clip.masks[0] ? withEdits(clip.masks[0], clip.edits[0]) : null;
  if (!m) return { x: clip.w / 2, y: clip.h - 1 };
  return anchorFromMask(m, clip.w, clip.h);
}
export function stanceHeight(ctx) {
  const c = ctx.p.clips[ctx.p.poses.stance]; if (!c || !c.masks[0]) return 0;
  return anchorFromMask(withEdits(c.masks[0], c.edits[0]), c.w, c.h).height;
}

let pickKey = false;

function editor(ctx, clip) {
  const i = Math.min(ctx.sel.frame, clip.frames.length - 1);
  const W = clip.w, H = clip.h;
  const cv = h('canvas', { style: { cursor: 'crosshair', touchAction: 'none' } }); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const bgImg = backdrop.startsWith('level') ? Object.assign(new Image(), { src: `img/stages/${backdrop}.jpg` }) : null;
  const cursor = { x: -1, y: -1 };
  const draw = () => {
    if (backdrop === 'checker') { for (let yy = 0; yy < H; yy += 12) for (let xx = 0; xx < W; xx += 12) { x.fillStyle = ((xx + yy) / 12) % 2 ? '#4a3f37' : '#2f2722'; x.fillRect(xx, yy, 12, 12); } }
    else if (bgImg) { if (bgImg.complete) x.drawImage(bgImg, 0, 0, W, H); else bgImg.onload = draw; }
    else { x.fillStyle = backdrop; x.fillRect(0, 0, W, H); }
    if (showMaskTint) {
      x.globalAlpha = 0.35; x.drawImage(toCanvas(clip.frames[i]), 0, 0); x.globalAlpha = 1;
      x.fillStyle = 'rgba(224,48,30,.28)'; x.fillRect(0, 0, W, H);
    }
    x.drawImage(ctx.frameCanvas(clip, i), 0, 0);
    if (ctx.mode === 'pro') {
      const a = clip.anchor || autoAnchor(clip);
      x.fillStyle = '#ffe08a'; x.fillRect(0, Math.round(a.y), W, 2);
      x.fillStyle = '#5fe3ff'; x.fillRect(Math.round(a.x), 0, 2, H);
    }
    if (cursor.x >= 0) { x.strokeStyle = brush.mode === 'keep' ? '#3ee05a' : brush.mode === 'remove' ? '#e0301e' : '#efe3c8'; x.lineWidth = 1.5; x.beginPath(); x.arc(cursor.x, cursor.y, brush.size, 0, Math.PI * 2); x.stroke(); }
  };
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  let painting = false, dragging = null, last = null;
  const stamp = (px, py) => {
    const frames = brush.all ? clip.frames.map((_, k) => k) : [i];
    const r = brush.size, r2 = r * r, v = brush.mode === 'keep' ? 1 : brush.mode === 'remove' ? -1 : 0;
    for (const k of frames) {
      let e = clip.edits[k]; if (!e) e = clip.edits[k] = new Int8Array(W * H);
      for (let yy = Math.max(0, Math.floor(py - r)); yy <= Math.min(H - 1, Math.ceil(py + r)); yy++)
        for (let xx = Math.max(0, Math.floor(px - r)); xx <= Math.min(W - 1, Math.ceil(px + r)); xx++)
          if ((xx - px) ** 2 + (yy - py) ** 2 <= r2) e[yy * W + xx] = v;
    }
  };
  cv.addEventListener('pointerdown', e => {
    const p = pos(e); cv.setPointerCapture(e.pointerId);
    if (pickKey) {
      const d = clip.frames[i].data, o = (Math.floor(p.y) * W + Math.floor(p.x)) * 4;
      ctx.p.cut.keyColor = [d[o], d[o + 1], d[o + 2]]; pickKey = false; if (ctx.p.cut.method === 'auto' || ctx.p.cut.method === 'ai') ctx.p.cut.method = 'aikey';
      toast('Backdrop colour set. Press "Redo this pose" to use it.'); ctx.refresh(); return;
    }
    if (ctx.mode === 'pro') {
      const a = clip.anchor || autoAnchor(clip);
      if (Math.abs(p.y - a.y) < 6) dragging = 'y'; else if (Math.abs(p.x - a.x) < 6) dragging = 'x';
      if (dragging) { clip.anchor = { ...a }; return; }
    }
    undo.push({ clip, edits: clip.edits.map(e => e && e.slice()) }); if (undo.length > 20) undo.shift();
    painting = true; last = p; stamp(p.x, p.y); clip.ver = (clip.ver || 0) + 1; draw();
  });
  cv.addEventListener('pointermove', e => {
    const p = pos(e); cursor.x = p.x; cursor.y = p.y;
    if (dragging) { clip.anchor[dragging] = dragging === 'y' ? p.y : p.x; draw(); return; }
    if (painting) {
      const steps = Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / Math.max(1, brush.size / 3));
      for (let s = 1; s <= steps; s++) stamp(last.x + (p.x - last.x) * s / steps, last.y + (p.y - last.y) * s / steps);
      last = p; clip.ver = (clip.ver || 0) + 1;
    }
    draw();
  });
  const end = () => { if (painting || dragging) { painting = false; dragging = null; ctx.touch(clip); ctx.refreshFilm({ onPick: k => { ctx.sel.frame = k; ctx.el.viewport.innerHTML = ''; editor(ctx, clip); } }); ctx.refreshMoves(); } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { cursor.x = -1; draw(); });
  const nav = d => { ctx.sel.frame = (i + d + clip.frames.length) % clip.frames.length; ctx.el.viewport.innerHTML = ''; editor(ctx, clip); };
  put(ctx.el.viewport, h('div', { class: 'preview-wrap' }, h('div', { class: 'screen' }, cv),
    h('div', { class: 'row' }, h('button', { class: 'slab small', onclick: () => nav(-1) }, 'Previous frame'), h('span', { class: 'dim' }, `Frame ${i + 1} of ${clip.frames.length}`), h('button', { class: 'slab small', onclick: () => nav(1) }, 'Next frame'),
      h('button', { class: 'slab small brass', onclick: () => ctx.go('paint') }, 'On to painting'))));
  draw();
  ctx.refreshFilm({ onPick: k => { ctx.sel.frame = k; ctx.el.viewport.innerHTML = ''; editor(ctx, clip); } });
}

function doUndo(ctx) {
  const u = undo.pop(); if (!u) return toast('Nothing to undo.');
  u.clip.edits = u.edits; ctx.touch(u.clip); ctx.refresh();
}

const tmp = new WeakMap();
function toCanvas(img) {
  let c = tmp.get(img); if (c) return c;
  c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0); tmp.set(img, c); return c;
}
export { analyzeBorder };
