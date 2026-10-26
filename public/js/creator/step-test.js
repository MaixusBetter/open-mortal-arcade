// step-test.js - Step 5: build the real fighter files, watch every move with hit boxes, send it to the arcade.
import { h, toast, blip, download, put } from '../ui.js';
import { GROUPS, GROUP_BY_ID, buildDatTxt } from '../omformat.js';
import { missingPoses, groupsMissing } from './state.js';
import { buildFighter, packZip, gifForGroup } from './build.js';
import { saveProject } from './project-io.js';

let playing = true, showBoxes = false, mirror = false, current = 'stand', timer = 0, fi = 0;

export function unmount() { clearTimeout(timer); }

export async function mount(ctx) {
  const T = ctx.el.tools, V = ctx.el.viewport;
  const miss = missingPoses(ctx.p);
  const gmiss = groupsMissing(ctx.p);
  if (gmiss.length) {
    put(V, h('div', { class: 'empty' }, h('h1', { class: 'title' }, 'A few poses to go'),
      h('p', { class: 'dim' }, `OpenMortal needs every basic move. Still missing: ${(miss.length ? miss.map(p => p.name) : gmiss.map(g => g.label)).join(', ')}.`),
      h('p', { class: 'dim' }, 'Tip: "Borrow" fills a pose from a stock fighter if you are short on time.'),
      h('button', { class: 'slab blood', onclick: () => { ctx.select('pose', (miss[0] || { id: 'stance' }).id); ctx.go('footage'); } }, 'Film the next missing pose')));
    put(T, h('h2', {}, 'Not ready yet'), h('p', { class: 'small dim' }, 'Every pose except "Special move" is needed.'));
    ctx.el.film.innerHTML = ''; return;
  }
  if (ctx.build.stale || !ctx.build.result) {
    ctx.busy('Building your fighter...', 0);
    try {
      ctx.build.result = await buildFighter(ctx.p, { onProgress: (t, v) => ctx.busy(t, v) });
      ctx.build.stale = false;
    } catch (e) {
      ctx.busy(null);
      put(V, h('div', { class: 'empty' }, h('h1', { class: 'title' }, 'The build stopped'), h('p', {}, e.message)));
      return;
    }
    ctx.busy(null);
  }
  const R = ctx.build.result;
  if (!R.counts[current]) current = 'stand';
  render(ctx, R);
}

function render(ctx, R) {
  const T = ctx.el.tools, V = ctx.el.viewport;
  const datSize = R.files[`${R.codename}.dat`].length;
  // ---- stage ----
  const cv = h('canvas'); cv.width = 640; cv.height = 480; const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
  const bg = Object.assign(new Image(), { src: 'img/stages/level1.jpg' });
  const tmp = document.createElement('canvas'); const tx = tmp.getContext('2d');
  const AX = 320, AY = 440 - 290;
  const frames = () => R.frames.filter(f => f.group === current);
  const seq = () => {
    const n = frames().length; const fwd = [...Array(n).keys()];
    const g = GROUP_BY_ID[current];
    return g && (g.attack || ['stand', 'hurt', 'block', 'fun', 'funb', 'threat'].includes(current)) && n > 2 ? fwd.concat(fwd.slice(0, -1).reverse().slice(0, -1)) : fwd;
  };
  const poly = (p, color) => { if (!p) return; x.beginPath(); for (let i = 0; i < p.length; i += 2) { const px = mirror ? AX - p[i] : AX + p[i]; x[i ? 'lineTo' : 'moveTo'](px, AY + p[i + 1]); } x.closePath(); x.fillStyle = color + '33'; x.strokeStyle = color; x.lineWidth = 2; x.fill(); x.stroke(); };
  const draw = () => {
    const s = seq(); const f = frames()[s[fi % s.length]];
    if (bg.complete && bg.naturalWidth) x.drawImage(bg, 0, 0); else { x.fillStyle = '#2f2722'; x.fillRect(0, 0, 640, 480); }
    if (!f) return;
    tmp.width = f.w; tmp.height = f.h; tx.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), f.w, f.h), 0, 0);
    x.save();
    if (mirror) { x.translate(640, 0); x.scale(-1, 1); }
    x.drawImage(tmp, AX + f.x, AY + f.y);
    x.restore();
    if (showBoxes) { poly(f.head, '#ffe08a'); poly(f.body, '#3cbcfc'); poly(f.legs, '#3ee05a'); poly(f.hit, '#ff3b2e'); }
    x.fillStyle = 'rgba(18,13,11,.7)'; x.fillRect(0, 456, 640, 24); x.fillStyle = '#efe3c8'; x.font = '600 15px "Pixelify Sans"';
    x.fillText(`${GROUP_BY_ID[current].label}  ${s[fi % s.length] + 1}/${frames().length}`, 10, 474);
  };
  bg.onload = draw;
  const loop = () => { clearTimeout(timer); if (!cv.isConnected) return; if (playing) { fi++; draw(); } timer = setTimeout(loop, 12 * (R.timing[current] || 5) * 1.0); };
  const pick = h('select', { 'aria-label': 'Animation', onchange: e => { current = e.target.value; fi = 0; if (ctx.mode === 'pro') ctx.refresh(); else draw(); } },
    GROUPS.filter(g => R.counts[g.id]).map(g => h('option', { value: g.id, selected: g.id === current }, `${g.label} (${R.counts[g.id]})`)));
  const playBtn = h('button', { class: 'slab small', onclick: () => { playing = !playing; playBtn.textContent = playing ? 'Pause' : 'Play'; } }, playing ? 'Pause' : 'Play');
  put(V, h('div', { class: 'preview-wrap' }, h('div', { class: 'screen' }, cv),
    h('div', { class: 'row' }, pick, playBtn,
      h('button', { class: 'slab small', onclick: () => { playing = false; playBtn.textContent = 'Play'; fi--; if (fi < 0) fi += seq().length; draw(); } }, 'Step back'),
      h('button', { class: 'slab small', onclick: () => { playing = false; playBtn.textContent = 'Play'; fi++; draw(); } }, 'Step'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: showBoxes, onchange: e => { showBoxes = e.target.checked; draw(); } }), 'Hit boxes'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: mirror, onchange: e => { mirror = e.target.checked; draw(); } }), 'Facing left')),
    showBoxes ? h('div', { class: 'legend' }, h('span', {}, h('i', { style: { background: '#ffe08a' } }), 'head'), h('span', {}, h('i', { style: { background: '#3cbcfc' } }), 'body'), h('span', {}, h('i', { style: { background: '#3ee05a' } }), 'legs'), h('span', {}, h('i', { style: { background: '#ff3b2e' } }), 'hit (fist or foot)')) : null));
  draw(); loop();

  // ---- Hands-on: drag hit-box corners. Edits go straight into the built .dat.txt and are kept for rebuilds. ----
  const curFrame = () => { const s = seq(); return frames()[s[fi % s.length]]; };
  const saveBoxes = list => {
    R.files[`${R.codename}.dat.txt`] = buildDatTxt(R.frames);
    ctx.p.boxes = ctx.p.boxes || {};
    for (const f of list) {
      const arr = ctx.p.boxes[f.group] = ctx.p.boxes[f.group] || [];
      arr[f.n - 1] = { head: f.head.slice(), body: f.body.slice(), legs: f.legs.slice(), hit: f.hit ? f.hit.slice() : null };
    }
    ctx.dirty = true;
  };
  if (ctx.mode === 'pro') {
    const toCanvas = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * 640 / r.width, y: (e.clientY - r.top) * 480 / r.height }; };
    let drag = null;
    cv.style.cursor = 'pointer';
    cv.addEventListener('pointerdown', e => {
      if (!showBoxes) return toast('Tick "Hit boxes" and pause to drag their corners.');
      if (playing) { playing = false; playBtn.textContent = 'Play'; }
      const f = curFrame(); if (!f) return; const p = toCanvas(e);
      let best = null, bd = 12;
      for (const key of ['hit', 'head', 'body', 'legs']) {
        const pl = f[key]; if (!pl) continue;
        for (let k = 0; k < pl.length; k += 2) { const d = Math.hypot((mirror ? AX - pl[k] : AX + pl[k]) - p.x, AY + pl[k + 1] - p.y); if (d < bd) { bd = d; best = { key, k }; } }
      }
      if (best) { drag = { f, ...best }; cv.setPointerCapture(e.pointerId); }
    });
    cv.addEventListener('pointermove', e => {
      if (!drag) return; const p = toCanvas(e); const pl = drag.f[drag.key];
      pl[drag.k] = Math.round(mirror ? AX - p.x : p.x - AX); pl[drag.k + 1] = Math.round(p.y - AY); draw();
    });
    cv.addEventListener('pointerup', () => { if (drag) { saveBoxes([drag.f]); drag = null; } });
    if (GROUP_BY_ID[current] && GROUP_BY_ID[current].attack) put(V, h('div', { class: 'row' },
      h('button', { class: 'slab small', onclick: () => {
        const f = curFrame(); if (!f) return;
        const group = frames(); for (const g of group) g.hit = null;
        const tx = f.x + f.w - 4, ty = f.y + Math.round(f.h * (current.includes('kick') || current === 'sweep' ? 0.6 : 0.25));
        f.hit = [tx + 4, ty - 17, tx + 4, ty + 17, tx - 34, ty + 17, tx - 34, ty - 17];
        saveBoxes(group); showBoxes = true; draw(); toast('The hit now lands on this frame. Drag its corners onto the fist or foot.');
      } }, 'Make this the frame that hits'),
      h('span', { class: 'small dim' }, 'Pause, tick Hit boxes, then drag any corner.')));
  }

  // ---- send / download ----
  const status = h('p', { class: 'small dim', role: 'status' });
  const send = async () => {
    try {
      status.textContent = 'Sending...';
      const r = await fetch('api/fighters', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: packZip(R) });
      const meta = await r.json(); if (!r.ok) throw new Error(meta.error || 'Upload failed');
      blip('ok');
      status.textContent = `${meta.name} is at the arcade${meta.renamedFrom ? ` (saved as ${meta.codename}, because ${meta.renamedFrom} was taken)` : ''}. On the big screen, press "Change fighters" and pick them.`;
      toast(`${meta.name} joined the arcade roster.`);
    } catch (e) { status.textContent = 'Could not reach the arcade server: ' + e.message + '. Download the fighter pack instead and hand it to whoever runs the big screen.'; }
  };
  put(T, 
    h('h2', {}, R.counts ? 'Your fighter is built' : ''),
    h('p', { class: 'small dim' }, `${R.frames.length} frames, ${(datSize / 1e6).toFixed(1)} MB of sprites in 63 colours. These are the exact files OpenMortal loads.`),
    h('button', { class: 'slab blood', onclick: send }, 'Send to the arcade'),
    status,
    h('div', { class: 'stack', style: { marginTop: '6px' } },
      h('button', { class: 'slab small', onclick: () => download(`${R.codename}-openmortal-fighter.zip`, packZip(R), 'application/zip') }, 'Download fighter pack (.zip)'),
      h('button', { class: 'slab small', onclick: () => { const g = gifForGroup(R, current); if (g) download(`${R.codename}-${current}.gif`, g, 'image/gif'); } }, 'Download this move as a GIF'),
      h('button', { class: 'slab small', onclick: async () => { ctx.busy('Saving project...'); try { await saveProject(ctx); } finally { ctx.busy(null); } } }, 'Save the project to keep editing later')),
    h('h3', {}, 'Moves in the game'),
    h('div', { class: 'tip small' },
      h('div', {}, 'Punches, kicks, block, crouch and jump work like every OpenMortal fighter.'),
      h('div', {}, h('b', {}, ctx.p.special.label || 'Special'), ': ', (ctx.p.special.combo || '').replace(/^(hpunch|lpunch|hkick|lkick)(.*)$/, (m, b, d) => [...d].map(c => ({ F: 'Forward', B: 'Back', D: 'Down', U: 'Up' })[c]).concat({ hpunch: 'High punch', lpunch: 'Low punch', hkick: 'High kick', lkick: 'Low kick' }[b]).join(', ')))),
    h('p', { class: 'small dim' }, 'Want it on your own PC? Unzip the pack into OpenMortal\'s data/characters folder.'));
  // film: a frame of every animation
  const F = ctx.el.film; F.innerHTML = '';
  for (const g of GROUPS) {
    const f = R.frames.find(fr => fr.group === g.id); if (!f) continue;
    const c = document.createElement('canvas'); c.width = f.w; c.height = f.h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f.rgba), f.w, f.h), 0, 0);
    const b = h('button', { class: 'fr', 'aria-current': String(g.id === current), title: g.label }, c);
    b.onclick = () => { current = g.id; fi = 0; pick.value = g.id; draw(); F.querySelectorAll('.fr').forEach(el => el.setAttribute('aria-current', String(el === b))); };
    put(F, b);
  }
}
