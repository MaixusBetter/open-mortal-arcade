// stage.js - stage builder: a 1920x480 photo/painted panorama, or parallax layers (.desc + PNGs).
import { $, h, put, toast, blip, download } from './ui.js';
import { PALETTE, STAMPS, stampCanvas, disc, stampAt, flood, plot } from './creator/step-paint.js';
import { buildStageDesc } from './omformat.js';
import { buildPalette, makeMapper } from './quantize.js';
import { encodeIndexedPNGAsync, encodePNGAsync } from './png.js';
import { writeZip } from './zip.js';

const W = 1920, H = 480, VIEW = 640, CAM_MAX = W - VIEW, FLOOR = 460;
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mk = (w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; };

const S = {
  mode: 'photo', name: '', author: '', cam: CAM_MAX / 2,
  photo: { img: null, zoom: 1, panX: 0.5, panY: 0.5, sides: 'mirror', base: mk(W, H), paint: mk(W, H) },
  layers: [],
  sel: 0, tool: 'brush', color: 12, size: 6, stamp: 'star',
};
const layerWidth = speed => Math.ceil(VIEW + CAM_MAX * speed);
function newLayer(name, speed, y, hgt) { return { name, speed, x: 0, y, canvas: mk(layerWidth(speed), hgt) }; }
S.layers = [newLayer('Sky', 0.15, 0, 480), newLayer('Far away', 0.5, 120, 360), newLayer('Ground', 1, 340, 140)];
// a starter sky + floor so the layered stage is never blank
(() => {
  const sky = S.layers[0].canvas.getContext('2d'); const g = sky.createLinearGradient(0, 0, 0, 480);
  g.addColorStop(0, '#0058f8'); g.addColorStop(1, '#3cbcfc'); sky.fillStyle = g; sky.fillRect(0, 0, sky.canvas.width, 480);
  const gr = S.layers[2].canvas.getContext('2d'); gr.fillStyle = '#585858'; gr.fillRect(0, 20, gr.canvas.width, 120); gr.fillStyle = '#a8a8a8'; gr.fillRect(0, 20, gr.canvas.width, 6);
  const ph = S.photo.base.getContext('2d'); const p = ph.createLinearGradient(0, 0, 0, 480);
  p.addColorStop(0, '#2b1a3a'); p.addColorStop(0.62, '#a81000'); p.addColorStop(0.63, '#4a3f37'); p.addColorStop(1, '#2f2722'); ph.fillStyle = p; ph.fillRect(0, 0, W, H);
})();

// fighters standing on the floor, from the real game files
const fighters = [];
fetch('img/attract.json').then(r => r.json()).then(async m => {
  for (const [name, x, flip] of [['Zoli', 210, false], ['UPi', 430, true]]) {
    const im = new Image(); im.src = `img/attract-${name}.png`; await im.decode();
    fighters.push({ im, m: m[name], x, flip });
  }
  draw();
}).catch(() => {});

const game = $('#game'), gx = game.getContext('2d'); gx.imageSmoothingEnabled = false;
const strip = $('#strip'), sx = strip.getContext('2d');

function composePhoto() {
  const P = S.photo, b = P.base.getContext('2d');
  if (!P.img) return;
  b.clearRect(0, 0, W, H);
  const iw = P.img.width, ih = P.img.height;
  const scale = (H / ih) * P.zoom;
  const dw = iw * scale, dh = ih * scale;
  const dx = (W - dw) * P.panX, dy = (H - dh) * P.panY;
  if (dw < W && P.sides !== 'none') {
    if (P.sides === 'stretch') { b.filter = 'blur(10px)'; b.drawImage(P.img, -20, -20, W + 40, H + 40); b.filter = 'none'; }
    else if (P.sides === 'mirror') {
      for (let x = dx - dw, k = 1; x > -dw; x -= dw, k++) { b.save(); b.translate(x + (k % 2 ? dw : 0), 0); b.scale(k % 2 ? -1 : 1, 1); b.drawImage(P.img, 0, dy, dw, dh); b.restore(); }
      for (let x = dx + dw, k = 1; x < W; x += dw, k++) { b.save(); b.translate(x + (k % 2 ? dw : 0), 0); b.scale(k % 2 ? -1 : 1, 1); b.drawImage(P.img, 0, dy, dw, dh); b.restore(); }
    }
  }
  b.drawImage(P.img, dx, dy, dw, dh);
}

function drawScene(ctx, camX, w, hgt) {
  const s = w / VIEW;
  ctx.save(); ctx.scale(s, hgt / H);
  if (S.mode === 'photo') {
    ctx.drawImage(S.photo.base, -camX, 0); ctx.drawImage(S.photo.paint, -camX, 0);
  } else {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VIEW, H);
    for (const L of S.layers) ctx.drawImage(L.canvas, Math.round(L.x - camX * L.speed), L.y);
  }
  ctx.restore();
}

function draw() {
  gx.clearRect(0, 0, VIEW, H);
  drawScene(gx, S.cam, VIEW, H);
  for (const f of fighters) {
    gx.save(); gx.globalAlpha = 0.92;
    const x = f.x - f.m.anchorX, y = FLOOR - f.m.feetY;
    if (f.flip) { gx.translate(f.x * 2, 0); gx.scale(-1, 1); }
    gx.drawImage(f.im, 0, 0, f.m.w, f.m.h, x, y, f.m.w, f.m.h);
    gx.restore();
  }
  gx.setLineDash([6, 6]); gx.strokeStyle = 'rgba(255,224,138,.7)'; gx.beginPath(); gx.moveTo(0, FLOOR + 0.5); gx.lineTo(VIEW, FLOOR + 0.5); gx.stroke(); gx.setLineDash([]);
  gx.fillStyle = 'rgba(255,224,138,.85)'; gx.font = '600 13px "Pixelify Sans"'; gx.fillText('fighters stand here', 8, FLOOR - 6);
  // overview strip: whole stage at camera-centred parallax for layers
  sx.clearRect(0, 0, strip.width, strip.height);
  if (S.mode === 'photo') { sx.drawImage(S.photo.base, 0, 0, strip.width, strip.height); sx.drawImage(S.photo.paint, 0, 0, strip.width, strip.height); }
  else for (let k = 0; k < 3; k++) { const cam = CAM_MAX * k / 2; sx.save(); sx.translate(k * strip.width / 3, 0); drawScene(sx, cam, strip.width / 3, strip.height); sx.restore(); }
  const vw = strip.width * VIEW / W, vx = strip.width * S.cam / W;
  if (S.mode === 'photo') { sx.strokeStyle = '#ffe08a'; sx.lineWidth = 3; sx.strokeRect(vx + 1.5, 1.5, vw - 3, strip.height - 3); }
}

// ---------------------------------------------------------------------------
// Painting in the game view
// ---------------------------------------------------------------------------
function target() {
  if (S.mode === 'photo') return { canvas: S.photo.paint, ox: S.cam, oy: 0 };
  const L = S.layers[S.sel]; return { canvas: L.canvas, ox: S.cam * L.speed - L.x, oy: -L.y };
}
let painting = false, last = null, img = null, undo = [];
function pos(e) { const r = game.getBoundingClientRect(); return { x: (e.clientX - r.left) * VIEW / r.width, y: (e.clientY - r.top) * H / r.height }; }
function apply(p) {
  const t = target(); const x = p.x + t.ox, y = p.y + t.oy;
  const rgb = hex(PALETTE[S.color]); const r = S.tool === 'pencil' ? 0 : Math.round(S.size / 2);
  if (S.tool === 'spray') { for (let k = 0; k < 10 + S.size * 2; k++) { const a = Math.random() * 6.283, d = Math.random() * (S.size * 3 + 4); plot(img, x + Math.cos(a) * d, y + Math.sin(a) * d, rgb); } }
  else disc(img, x, y, r, rgb, S.tool === 'eraser');
}
game.addEventListener('pointerdown', e => {
  const t = target(); const ctx = t.canvas.getContext('2d', { willReadFrequently: true });
  undo.push({ canvas: t.canvas, data: ctx.getImageData(0, 0, t.canvas.width, t.canvas.height) }); if (undo.length > 15) undo.shift();
  img = ctx.getImageData(0, 0, t.canvas.width, t.canvas.height);
  const p = pos(e);
  if (S.tool === 'stamp') { stampAt(img, p.x + t.ox, p.y + t.oy, S.stamp, S.size * 2); ctx.putImageData(img, 0, 0); blip('move'); draw(); return; }
  if (S.tool === 'fill') { flood(img, p.x + t.ox, p.y + t.oy, hex(PALETTE[S.color])); ctx.putImageData(img, 0, 0); draw(); return; }
  game.setPointerCapture(e.pointerId); painting = true; last = p; apply(p); ctx.putImageData(img, 0, 0); draw();
});
game.addEventListener('pointermove', e => {
  if (!painting) return; const p = pos(e); const n = Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y)));
  for (let k = 1; k <= n; k++) apply({ x: last.x + (p.x - last.x) * k / n, y: last.y + (p.y - last.y) * k / n });
  last = p; target().canvas.getContext('2d').putImageData(img, 0, 0); draw();
});
const stop = () => { painting = false; };
game.addEventListener('pointerup', stop); game.addEventListener('pointercancel', stop);

// drag the overview strip to move the camera
let dragging = false;
const camFrom = e => { const r = strip.getBoundingClientRect(); S.cam = Math.max(0, Math.min(CAM_MAX, ((e.clientX - r.left) / r.width) * W - VIEW / 2)); draw(); };
strip.addEventListener('pointerdown', e => { dragging = true; strip.setPointerCapture(e.pointerId); camFrom(e); });
strip.addEventListener('pointermove', e => { if (dragging) camFrom(e); });
strip.addEventListener('pointerup', () => (dragging = false));
addEventListener('keydown', e => { if (e.target.closest('input, textarea, select')) return; if (e.key === 'ArrowLeft') { S.cam = Math.max(0, S.cam - 40); draw(); } if (e.key === 'ArrowRight') { S.cam = Math.min(CAM_MAX, S.cam + 40); draw(); } });

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
async function loadImage(file) { const bmp = await createImageBitmap(file); return bmp; }

function panel() {
  const P = $('#panel'); P.innerHTML = '';
  const toolBtn = (id, label) => h('button', { class: 'slab small', 'aria-pressed': String(S.tool === id), onclick: () => { S.tool = id; panel(); } }, label);
  put(P,
    h('h2', {}, S.mode === 'photo' ? 'Photo stage' : 'Layered stage'),
    h('p', { class: 'small dim' }, S.mode === 'photo' ? 'One wide picture behind the fight. A phone panorama of your campus works great.' : 'Layers further away scroll slower, which gives the fight depth. This is how the stock moon and space stages are built.'),
    h('label', { class: 'field' }, 'Stage name', h('input', { type: 'text', value: S.name, maxlength: 40, placeholder: 'Tabaret Lawn', oninput: e => (S.name = e.target.value) })),
    h('label', { class: 'field' }, 'Made by', h('input', { type: 'text', value: S.author, maxlength: 40, oninput: e => (S.author = e.target.value) })),
  );
  if (S.mode === 'photo') {
    const Ph = S.photo;
    put(P, h('h3', {}, 'Picture'),
      h('label', { class: 'slab' }, 'Upload a photo', h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => { const f = e.target.files[0]; if (!f) return; Ph.img = await loadImage(f); Ph.zoom = 1; Ph.panX = 0.5; Ph.panY = 0.5; composePhoto(); draw(); panel(); } })),
      Ph.img ? h('div', { class: 'stack', style: { marginTop: '8px' } },
        h('label', { class: 'field' }, 'Zoom', h('input', { type: 'range', min: 1, max: 3, step: 0.01, value: Ph.zoom, oninput: e => { Ph.zoom = +e.target.value; composePhoto(); draw(); } })),
        h('label', { class: 'field' }, 'Left / right', h('input', { type: 'range', min: 0, max: 1, step: 0.005, value: Ph.panX, oninput: e => { Ph.panX = +e.target.value; composePhoto(); draw(); } })),
        h('label', { class: 'field' }, 'Up / down (line the floor up with the dashed line)', h('input', { type: 'range', min: 0, max: 1, step: 0.005, value: Ph.panY, oninput: e => { Ph.panY = +e.target.value; composePhoto(); draw(); } })),
        h('label', { class: 'field' }, 'If the photo is not wide enough', h('select', { onchange: e => { Ph.sides = e.target.value; composePhoto(); draw(); } },
          h('option', { value: 'mirror', selected: Ph.sides === 'mirror' }, 'Mirror it to fill the sides'), h('option', { value: 'stretch', selected: Ph.sides === 'stretch' }, 'Stretch a blurry copy behind it'), h('option', { value: 'none', selected: Ph.sides === 'none' }, 'Leave the sides painted')))) : null);
  } else {
    put(P, h('h3', {}, 'Layers, back to front'), h('div', { class: 'layers' }, S.layers.map((L, i) => h('div', { class: 'layer', 'aria-current': String(i === S.sel), onclick: () => { S.sel = i; panel(); } },
      h('span', {}, L.name, h('small', {}, `scrolls at ${Math.round(L.speed * 100)}%, ${L.canvas.width} x ${L.canvas.height}`)),
      h('span', {}, i > 0 ? h('button', { class: 'slab small', 'aria-label': 'Move back', onclick: e => { e.stopPropagation(); [S.layers[i - 1], S.layers[i]] = [S.layers[i], S.layers[i - 1]]; S.sel = i - 1; panel(); draw(); } }, 'Back') : null)))));
    const L = S.layers[S.sel];
    put(P, h('div', { class: 'stack', style: { marginTop: '8px' } },
      h('label', { class: 'field' }, `Scroll speed (${Math.round(L.speed * 100)}%)`, h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: L.speed, onchange: e => {
        const sp = +e.target.value, old = L.canvas; L.speed = sp; L.canvas = mk(layerWidth(sp), old.height); L.canvas.getContext('2d').drawImage(old, 0, 0, L.canvas.width, old.height); draw(); panel(); } })),
      h('label', { class: 'field' }, 'Height on screen', h('input', { type: 'range', min: -100, max: 460, value: L.y, oninput: e => { L.y = +e.target.value; draw(); } })),
      h('label', { class: 'slab small' }, 'Fill this layer with a picture', h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
        const f = e.target.files[0]; if (!f) return; const im = await loadImage(f); const c = L.canvas.getContext('2d');
        const s = Math.max(L.canvas.width / im.width, L.canvas.height / im.height); c.clearRect(0, 0, L.canvas.width, L.canvas.height);
        c.drawImage(im, (L.canvas.width - im.width * s) / 2, (L.canvas.height - im.height * s) / 2, im.width * s, im.height * s); draw(); } })),
      h('div', { class: 'row' },
        h('button', { class: 'slab small', onclick: () => { L.canvas.getContext('2d').clearRect(0, 0, L.canvas.width, L.canvas.height); draw(); } }, 'Clear layer'),
        S.layers.length < 6 ? h('button', { class: 'slab small', onclick: () => { S.layers.push(newLayer(`Layer ${S.layers.length + 1}`, 0.7, 200, 280)); S.sel = S.layers.length - 1; panel(); draw(); } }, 'Add a layer') : null,
        S.layers.length > 1 ? h('button', { class: 'slab small', onclick: () => { S.layers.splice(S.sel, 1); S.sel = 0; panel(); draw(); } }, 'Delete layer') : null)));
  }
  put(P, h('h3', {}, 'Paint'),
    h('div', { class: 'palette' }, PALETTE.map((c, i) => h('button', { style: { background: c }, 'aria-label': `Colour ${i + 1}`, 'aria-pressed': String(i === S.color && S.tool !== 'eraser'), onclick: () => { S.color = i; if (S.tool === 'eraser') S.tool = 'brush'; panel(); } }))),
    h('div', { class: 'row', style: { marginTop: '6px' } }, toolBtn('pencil', 'Pencil'), toolBtn('brush', 'Brush'), toolBtn('spray', 'Spray'), toolBtn('fill', 'Fill'), toolBtn('stamp', 'Stamp'), toolBtn('eraser', 'Eraser'),
      h('button', { class: 'slab small', onclick: () => { const u = undo.pop(); if (u) { u.canvas.getContext('2d').putImageData(u.data, 0, 0); draw(); } } }, 'Undo')),
    S.tool === 'stamp' ? h('div', { class: 'stamps', style: { marginTop: '6px' } }, Object.keys(STAMPS).map(n => h('button', { class: 'slab small', 'aria-pressed': String(S.stamp === n), 'aria-label': n, onclick: () => { S.stamp = n; panel(); } }, stampCanvas(n)))) : null,
    h('label', { class: 'field', style: { marginTop: '6px' } }, 'Size', h('input', { type: 'range', min: 1, max: 24, value: S.size, oninput: e => (S.size = +e.target.value) })),
    h('p', { class: 'small dim' }, S.mode === 'photo' ? 'Paint lands on top of the photo. The eraser removes paint only.' : `Painting on: ${S.layers[S.sel].name}. The eraser makes holes you can see through to the layers behind.`));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
async function canvasBlob(c, type, q) { return new Uint8Array(await (await new Promise(r => c.toBlob(r, type, q))).arrayBuffer()); }

async function quantizeLayer(c) {
  const x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data;
  const samples = []; for (let i = 0; i < d.length; i += 4 * 3) if (d[i + 3] >= 128) samples.push(d[i], d[i + 1], d[i + 2]);
  const pal = samples.length ? buildPalette(new Uint8Array(samples), 255) : [[0, 0, 0]];
  const map = makeMapper(pal); const px = new Uint8Array(c.width * c.height);
  for (let i = 0; i < px.length; i++) if (d[i * 4 + 3] >= 128) px[i] = 1 + map(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  return encodeIndexedPNGAsync(c.width, c.height, px, [[0, 0, 0], ...pal], 0);
}

async function buildPack() {
  const files = [];
  const name = S.name.trim() || 'Untitled stage';
  if (S.mode === 'photo') {
    const flat = mk(W, H), fx = flat.getContext('2d'); fx.drawImage(S.photo.base, 0, 0); fx.drawImage(S.photo.paint, 0, 0);
    files.push({ name: 'stage.jpg', data: await canvasBlob(flat, 'image/jpeg', 0.9) });
  } else {
    const layers = S.layers.map((L, i) => ({ file: `layer${i + 1}.png`, x: L.x, y: L.y, speed: L.speed, L }));
    for (const l of layers) files.push({ name: l.file, data: await quantizeLayer(l.L.canvas) });
    files.push({ name: 'stage.desc', data: buildStageDesc(layers) });
  }
  const pv = mk(640, 160), px = pv.getContext('2d'); drawScene(px, CAM_MAX / 2, 640, 160);
  files.push({ name: 'preview.png', data: await canvasBlob(pv, 'image/png') });
  files.push({ name: 'stage.json', data: JSON.stringify({ name, author: S.author, type: S.mode }) });
  files.push({ name: 'README.txt', data: `${name} - an OpenMortal 0.7 stage made with Mortal Arcade\n\nTo use it in OpenMortal on your own computer, copy the files into data/gfx and rename them\nso they continue the numbering (the game cycles level1, level2, ... until a number is missing):\n${S.mode === 'photo' ? '  stage.jpg  ->  level12.jpg' : '  stage.desc ->  level12.desc   and edit the file names inside it to match:\n  layer1.png ->  level12_layer1.png  (and so on)'}\n` });
  return { name, zip: writeZip(files) };
}

$('#send').onclick = async () => {
  try {
    const { name, zip } = await buildPack();
    const r = await fetch('api/stages', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: zip });
    const meta = await r.json(); if (!r.ok) throw new Error(meta.error);
    blip('ok'); toast(`${name} is at the arcade. On the big screen, press "Change fighters" and tick it.`);
  } catch (e) { toast('Could not reach the arcade server: ' + e.message + '. Download the stage pack instead.', { error: true, ms: 6000 }); }
};
$('#dl').onclick = async () => { const { name, zip } = await buildPack(); download(`${name.replace(/[^A-Za-z0-9]+/g, '-')}-openmortal-stage.zip`, zip, 'application/zip'); };

function setMode(m) { S.mode = m; $('#modePhoto').setAttribute('aria-pressed', String(m === 'photo')); $('#modeLayers').setAttribute('aria-pressed', String(m === 'layers')); panel(); draw(); }
$('#modePhoto').onclick = () => setMode('photo');
$('#modeLayers').onclick = () => setMode('layers');
panel(); draw();
