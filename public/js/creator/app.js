// app.js - fighter creator shell: modes, steps, move list, film strip, save/open.
import { $, $$, h, toast, blip } from '../ui.js';
import { GROUPS } from '../omformat.js';
import { POSES, POSE_BY_ID, newProject, resolveGroups, missingPoses } from './state.js';
import { composite } from './cutout.js';
import * as footage from './step-footage.js';
import * as cut from './step-cutout.js';
import * as paint from './step-paint.js';
import * as profile from './step-profile.js';
import * as test from './step-test.js';
import * as lessons from './lessons.js';
import { saveProject, openProject } from './project-io.js';

const STEPS = { footage, cutout: cut, paint, profile, test };
const GROUP_SECTIONS = [
  ['Basics', ['start', 'stand', 'walk', 'turn', 'block', 'kneeling', 'onknees', 'fun', 'funb', 'threat', 'won']],
  ['Attacks', ['highpunch', 'lowpunch', 'highkick', 'lowkick', 'groinkick', 'kneekick', 'elbow', 'spin', 'sweep', 'uppercut', 'kneelingpunch', 'kneelingkick', 'grenade', 'throw', 'special']],
  ['Getting hit', ['hurt', 'highpunched', 'lowpunched', 'groinkicked', 'kneelingpunched', 'kneelingkicked', 'swept', 'falling', 'laying', 'thrown']],
];

export const ctx = {
  p: newProject(),
  step: 'footage',
  sel: { kind: 'pose', pose: 'stance', group: 'stand', frame: 0 },
  el: { moves: $('#moves'), viewport: $('#viewport'), film: $('#film'), tools: $('#tab-tools'), lesson: $('#tab-lesson'), code: $('#tab-code') },
  source: null,          // the uploaded video / gif shared by every pose
  build: { result: null, stale: true },
  dirty: false,
  get mode() { return this.p.mode; },
  clip() {
    if (this.sel.kind === 'group') {
      const g = resolveGroups(this.p)[this.sel.group];
      return g && g.length ? this.p.clips[g[0].clip] : null;
    }
    const id = this.p.poses[this.sel.pose]; return id ? this.p.clips[id] : null;
  },
  markDirty() { this.dirty = true; this.build.stale = true; },
  refresh() { render(); },
  refreshMoves() { renderMoves(); },
  refreshFilm(opts) { renderFilm(opts); },
  busy(text, value = null) {
    $('#busy').hidden = !text; $('#busyText').textContent = text || '';
    const bar = $('#busyBar'); if (value == null) bar.removeAttribute('value'); else bar.value = value;
  },
  go(step) { setStep(step); },
  select(kind, id) {
    if (kind === 'pose') { this.sel.kind = 'pose'; this.sel.pose = id; }
    else { this.sel.kind = 'group'; this.sel.group = id; }
    this.sel.frame = 0; render();
  },
};
window.__ctx = ctx;   // handy for debugging from the console

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------
// Rendered composites keyed by clip id, frame and the clip's edit version (clip.ver).
const thumbCache = new Map();
export function frameCanvas(clip, i) {
  const key = `${clip.id}:${i}:${clip.ver || 0}`;
  let src = thumbCache.get(key);
  if (!src) {
    const f = clip.frames[i];
    const img = clip.masks[i] || clip.paint[i] ? composite(clip, i) : f;
    src = document.createElement('canvas'); src.width = f.width; src.height = f.height; src.getContext('2d').putImageData(img, 0, 0);
    if (img !== f) {
      // bounding box of the fighter, so thumbnails show the person rather than empty space
      let x0 = f.width, y0 = f.height, x1 = -1, y1 = -1; const d = img.data;
      for (let y = 0; y < f.height; y += 2) for (let x = 0; x < f.width; x += 2) if (d[(y * f.width + x) * 4 + 3] > 64) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 > 0) src._box = { x: Math.max(0, x0 - 4), y: Math.max(0, y0 - 4), w: Math.min(f.width, x1 + 6) - Math.max(0, x0 - 4), h: Math.min(f.height, y1 + 6) - Math.max(0, y0 - 4) };
    }
    if (thumbCache.size > 600) thumbCache.delete(thumbCache.keys().next().value);
    thumbCache.set(key, src);
  }
  return src;
}
export function thumb(clip, i, height = 44) {
  const c = document.createElement('canvas');
  if (!clip || !clip.frames[i]) { c.width = 1; c.height = 1; return c; }
  const src = frameCanvas(clip, i);
  const b = src._box && height < 60 ? src._box : { x: 0, y: 0, w: src.width, h: src.height };
  // list thumbnails: square crop around the fighter; film strip: whole frame
  const s = height / b.h; c.width = Math.max(1, Math.round(b.w * s)); c.height = height;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
  return c;
}
ctx.frameCanvas = frameCanvas;
ctx.touch = clip => { clip.ver = (clip.ver || 0) + 1; ctx.markDirty(); };

// ---------------------------------------------------------------------------
// Move list
// ---------------------------------------------------------------------------
function renderMoves() {
  const L = ctx.el.moves; L.innerHTML = '';
  L.append(h('h3', {}, ctx.mode === 'easy' ? 'Your poses' : 'Footage clips'));
  for (const pose of POSES) {
    const clip = ctx.p.poses[pose.id] && ctx.p.clips[ctx.p.poses[pose.id]];
    const isSpecialOff = pose.id === 'special' && !clip;
    const b = h('button', { class: 'move', 'aria-current': String(ctx.sel.kind === 'pose' && ctx.sel.pose === pose.id) },
      clip ? thumb(clip, 0) : h('img', { src: `img/guides/${pose.id}.png`, alt: '', style: { opacity: .35 } }),
      h('span', {}, pose.name, h('small', {}, clip ? `${clip.frames.length} frames${clip.source === 'borrow' ? ' (borrowed)' : ''}` : pose.optional ? 'optional' : 'not filmed yet')),
      h('i', { class: 'dot ' + (clip ? 'ok' : isSpecialOff ? 'opt' : '') }));
    b.onclick = () => { blip('move'); ctx.select('pose', pose.id); };
    L.append(b);
  }
  if (ctx.mode === 'pro') {
    const resolved = resolveGroups(ctx.p);
    for (const [title, ids] of GROUP_SECTIONS) {
      L.append(h('h3', {}, title));
      for (const gid of ids) {
        const g = GROUPS.find(x => x.id === gid); const r = resolved[gid];
        const firstClip = r && r[0] && ctx.p.clips[r[0].clip];
        const b = h('button', { class: 'move', 'aria-current': String(ctx.sel.kind === 'group' && ctx.sel.group === gid) },
          firstClip ? thumb(firstClip, r[0].index) : h('span', {}),
          h('span', {}, g.label, h('small', {}, r ? `${r.length} frames${ctx.p.groups[gid] ? ', custom' : ''}` : gid === 'special' ? 'optional' : 'needs footage')),
          h('i', { class: 'dot ' + (r ? 'ok' : gid === 'special' ? 'opt' : '') }));
        b.onclick = () => { blip('move'); ctx.select('group', gid); };
        L.append(b);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Film strip (frames of the selected clip / animation)
// ---------------------------------------------------------------------------
function renderFilm({ onPick } = {}) {
  const F = ctx.el.film; F.innerHTML = '';
  let refs;
  if (ctx.sel.kind === 'group') refs = resolveGroups(ctx.p)[ctx.sel.group] || [];
  else { const clip = ctx.clip(); refs = clip ? clip.frames.map((_, i) => ({ clip: clip.id, index: i })) : []; }
  if (!refs.length) { F.append(h('span', { class: 'hint' }, ctx.sel.kind === 'group' ? 'This animation has no frames yet. Film the pose it comes from, or pick frames in the Tools tab.' : 'Frames you capture for this pose show up here.')); return; }
  refs.forEach((r, i) => {
    const clip = ctx.p.clips[r.clip];
    const b = h('button', { class: 'fr', 'aria-current': String(i === ctx.sel.frame), title: `Frame ${i + 1}` }, thumb(clip, r.index, 72), h('span', {}, i + 1));
    b.onclick = () => { ctx.sel.frame = i; $$('.fr', F).forEach((x, k) => x.setAttribute('aria-current', String(k === i))); onPick ? onPick(i) : render(); };
    F.append(b);
  });
}

// ---------------------------------------------------------------------------
// Steps / tabs
// ---------------------------------------------------------------------------
let current = null;
function setStep(step) {
  ctx.step = step;
  $$('#steps button').forEach(b => b.setAttribute('aria-current', b.dataset.step === step ? 'step' : 'false'));
  render();
}

function render() {
  if (current && current.unmount) current.unmount(ctx);
  ctx.el.viewport.innerHTML = ''; ctx.el.tools.innerHTML = '';
  renderMoves();
  current = STEPS[ctx.step];
  current.mount(ctx);
  if (ctx.mode === 'pro') { lessons.renderLesson(ctx); lessons.renderCode(ctx); }
  // step badges
  const miss = missingPoses(ctx.p).length;
  $('#steps [data-step="footage"]').classList.toggle('done', !miss);
}

function setTab(tab) {
  $$('#tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  for (const t of ['lesson', 'tools', 'code']) $(`#tab-${t}`).hidden = t !== tab;
  if (tab === 'code') lessons.renderCode(ctx);
}

function setMode(mode) {
  ctx.p.mode = mode;
  $('#modeEasy').setAttribute('aria-pressed', String(mode === 'easy'));
  $('#modePro').setAttribute('aria-pressed', String(mode === 'pro'));
  $('#tabs').hidden = mode !== 'pro';
  if (mode === 'pro') setTab('lesson'); else { $('#tab-tools').hidden = false; $('#tab-lesson').hidden = true; $('#tab-code').hidden = true; }
  if (mode === 'easy' && ctx.sel.kind === 'group') ctx.sel.kind = 'pose';
  render();
}

$$('#steps button').forEach(b => (b.onclick = () => { blip('move'); setStep(b.dataset.step); }));
$$('#tabs button').forEach(b => (b.onclick = () => setTab(b.dataset.tab)));
$('#modeEasy').onclick = () => setMode('easy');
$('#modePro').onclick = () => setMode('pro');
export function showTab(t) { if (ctx.mode === 'pro') setTab(t); }
ctx.showTab = showTab;

$('#btnSave').onclick = async () => {
  try { ctx.busy('Saving project...'); await saveProject(ctx); ctx.dirty = false; toast('Project saved. Open it again any time with Open project.'); }
  catch (e) { toast(e.message, { error: true }); } finally { ctx.busy(null); }
};
$('#openFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; e.target.value = '';
  try { ctx.busy('Opening project...'); ctx.p = await openProject(f, (t, v) => ctx.busy(t, v)); ctx.build.stale = true; ctx.dirty = false; setMode(ctx.p.mode || 'easy'); toast(`Opened ${ctx.p.profile.name || 'your fighter'}.`); }
  catch (err) { toast('That file is not a Mortal Arcade fighter project: ' + err.message, { error: true }); } finally { ctx.busy(null); }
};
$('#btnSample').onclick = () => footage.loadSample(ctx);
addEventListener('beforeunload', e => { if (ctx.dirty) { e.preventDefault(); e.returnValue = ''; } });

setMode(new URLSearchParams(location.search).get('mode') === 'pro' ? 'pro' : 'easy');
export { POSE_BY_ID };
