// step-footage.js - Step 1: film each pose (camera), or take ranges from a video/GIF, or borrow a move.
import { h, toast, blip, api, put } from '../ui.js';
import { POSES, POSE_BY_ID, newClip, resolveGroups, sampleIndices, STOCK_GROUP_FOR_POSE } from './state.js';
import { GROUP_BY_ID } from '../omformat.js';
import { loadVideo, framesFromVideo, framesFromGif, framesFromImages, openCamera, stopCamera, recordFrames, capturePlate, seek } from './media.js';
import { cutClip } from './cutout.js';
import { borrowMove, listBorrowable } from './borrow.js';

let view = null;          // 'choices' | 'camera' | 'source' | 'borrow' | 'clip'
let cam = null;           // { stream, video }
let anim = 0;

export function unmount() { cancelAnimationFrame(anim); clearInterval(anim); if (cam) { stopCamera(cam.stream); cam = null; } }

export function mount(ctx) {
  if (ctx.sel.kind === 'group') return mountGroup(ctx);
  const pose = POSE_BY_ID[ctx.sel.pose];
  const clip = ctx.clip();
  if (!view || view === 'clip' || view === 'choices') view = clip ? 'clip' : ctx.source ? 'source' : 'choices';
  toolsPanel(ctx, pose, clip);
  if (view === 'camera') return cameraView(ctx, pose);
  if (view === 'source' && ctx.source) return sourceView(ctx, pose);
  if (view === 'borrow') return borrowView(ctx, pose);
  if (view === 'clip' && clip) return clipView(ctx, pose, clip);
  return choicesView(ctx, pose);
}

// ---------------------------------------------------------------------------
function toolsPanel(ctx, pose, clip) {
  const T = ctx.el.tools;
  put(T, 
    h('h2', {}, pose.name),
    h('div', { class: 'tip' }, h('b', {}, 'How: '), pose.tip),
    h('h3', {}, 'Get footage for this pose'),
    h('div', { class: 'stack' },
      h('button', { class: 'slab', onclick: () => { view = 'camera'; ctx.refresh(); } }, 'Film it with the camera'),
      h('label', { class: 'slab' }, 'Upload a video', h('input', { type: 'file', accept: 'video/*', hidden: true, onchange: e => useVideo(ctx, e.target.files[0]) })),
      h('label', { class: 'slab' }, 'Upload a GIF or pictures', h('input', { type: 'file', accept: 'image/gif,image/png,image/jpeg,image/webp', multiple: true, hidden: true, onchange: e => useImages(ctx, e.target.files) })),
      h('button', { class: 'slab', onclick: () => { view = 'borrow'; ctx.refresh(); } }, 'Borrow this move'),
    ),
    ctx.source ? h('p', { class: 'small dim', style: { marginTop: '8px' } }, `Loaded: ${ctx.source.name}. `, h('a', { href: '#', onclick: e => { e.preventDefault(); view = 'source'; ctx.refresh(); } }, 'Pick a range from it')) : null,
    h('h3', {}, 'Direction'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ctx.p.flip, onchange: e => { ctx.p.flip = e.target.checked; ctx.markDirty(); toast(e.target.checked ? 'Footage will be mirrored so you face right in the game.' : 'Footage is used as filmed.'); } }), 'I faced left in my footage'),
    h('p', { class: 'small dim' }, 'Fighters face right in OpenMortal. The game mirrors them for the other side.'),
    clip ? h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'slab small', onclick: () => { delete ctx.p.clips[clip.id]; ctx.p.poses[pose.id] = null; ctx.markDirty(); view = null; ctx.refresh(); } }, 'Delete this pose'),
      h('button', { class: 'slab small brass', onclick: () => nextPose(ctx) }, 'Next pose')) : null,
  );
}

function nextPose(ctx) {
  const i = POSES.findIndex(p => p.id === ctx.sel.pose);
  const next = POSES.slice(i + 1).find(p => !ctx.p.poses[p.id]) || POSES.find(p => !ctx.p.poses[p.id] && !p.optional);
  view = null;
  if (next) ctx.select('pose', next.id);
  else { toast('Every pose has footage. On to cutting out the background.'); ctx.go('cutout'); }
}

function choicesView(ctx, pose) {
  put(ctx.el.viewport, h('div', { class: 'empty' },
    h('img', { src: `img/guides/${pose.id}.png`, alt: '', style: { height: '200px', opacity: .5 } }),
    h('h1', { class: 'title' }, pose.name),
    h('p', { class: 'dim', style: { margin: '0 auto' } }, pose.tip),
    h('div', { class: 'choices' },
      h('button', { class: 'slab blood', onclick: () => { view = 'camera'; ctx.refresh(); } }, 'Camera', h('small', {}, 'Strike the pose, 3-2-1')),
      h('label', { class: 'slab' }, 'Video', h('small', {}, 'One long take is fine'), h('input', { type: 'file', accept: 'video/*', hidden: true, onchange: e => useVideo(ctx, e.target.files[0]) })),
      h('label', { class: 'slab' }, 'GIF or pictures', h('small', {}, 'Cut-out GIFs keep their transparency'), h('input', { type: 'file', accept: 'image/gif,image/png,image/jpeg,image/webp', multiple: true, hidden: true, onchange: e => useImages(ctx, e.target.files) })),
      h('button', { class: 'slab', onclick: () => { view = 'borrow'; ctx.refresh(); } }, 'Borrow', h('small', {}, 'Mix and match a move from another fighter')),
    )));
  ctx.refreshFilm();
}

// ---------------------------------------------------------------------------
// Camera booth
// ---------------------------------------------------------------------------
async function cameraView(ctx, pose) {
  const V = ctx.el.viewport;
  const video = h('video', { playsinline: true, muted: true, style: { transform: 'scaleX(-1)' } });
  const ghost = h('img', { class: 'ghost', src: `img/guides/${pose.id}.png`, alt: '' });
  const screen = h('div', { class: 'screen' }, video, ghost);
  const status = h('p', { class: 'dim small' }, 'Starting the camera...');
  const recBtn = h('button', { class: 'slab blood', disabled: true }, `Record ${pose.name}`);
  const plateBtn = h('button', { class: 'slab', disabled: true }, ctx.p.cut.plate ? 'Retake empty background' : 'Shoot the empty background');
  put(V, h('div', { class: 'preview-wrap' }, screen, h('div', { class: 'row' }, recBtn, plateBtn, h('button', { class: 'slab', onclick: () => { view = null; ctx.refresh(); } }, 'Done with camera')), status));
  ctx.refreshFilm();
  try {
    cam = { stream: await openCamera(video), video };
    status.textContent = 'Stand so your whole body fits, feet near the bottom, and match the ghost: face the right side of the screen. Shoot the empty background first for the cleanest cutout.';
    recBtn.disabled = false; plateBtn.disabled = false;
  } catch (e) {
    status.textContent = e.message; status.style.color = 'var(--blood-hi)'; return;
  }
  const countdown = async n => {
    const c = h('div', { class: 'count' }); screen.append(c);
    for (let i = n; i > 0; i--) { c.textContent = i; blip('move'); await new Promise(r => setTimeout(r, 800)); }
    c.textContent = 'Go!'; blip('ok'); setTimeout(() => c.remove(), 400);
  };
  plateBtn.onclick = async () => {
    plateBtn.disabled = recBtn.disabled = true;
    status.textContent = 'Step out of the picture...';
    await countdown(3);
    // the selfie preview is mirrored; frames are mirrored too so they match the clips
    ctx.p.cut.plate = await capturePlate(video, { mirror: true });
    status.textContent = 'Background captured. Cutouts from the camera now compare against it.';
    plateBtn.textContent = 'Retake empty background'; plateBtn.disabled = recBtn.disabled = false; ctx.markDirty();
  };
  recBtn.onclick = async () => {
    plateBtn.disabled = recBtn.disabled = true;
    await countdown(3);
    const rec = h('div', { class: 'rec' }, 'REC'); screen.append(rec);
    const shot = await recordFrames(video, { seconds: pose.seconds, fps: 12, mirror: true });
    rec.remove();
    // keep an even sample of the frames the pose needs (a few extra for hands-on tweaking)
    const idx = sampleIndices(0, shot.frames.length - 1, Math.min(shot.frames.length, pose.frames * 2));
    const clip = newClip({ name: pose.name, w: shot.w, h: shot.h, frames: idx.map(i => shot.frames[i]), fps: 12, source: 'camera' });
    // mirrored preview = person faces screen-left when they face their own right... flip setting handles it
    await finishClip(ctx, pose, clip);
    plateBtn.disabled = recBtn.disabled = false;
  };
}

// ---------------------------------------------------------------------------
// Uploaded video / GIF: pick a range per pose
// ---------------------------------------------------------------------------
async function useVideo(ctx, file) {
  if (!file) return;
  try {
    ctx.busy('Loading video...');
    const video = await loadVideo(file);
    ctx.source = { kind: 'video', name: file.name || 'video', video, duration: video.duration, ranges: {} };
    view = 'source'; ctx.refresh();
  } catch (e) { toast(e.message, { error: true, ms: 6000 }); } finally { ctx.busy(null); }
}

async function useImages(ctx, files) {
  if (!files || !files.length) return;
  try {
    ctx.busy('Reading frames...');
    const isGif = files.length === 1 && /gif$/i.test(files[0].type || files[0].name);
    const data = isGif ? await framesFromGif(files[0]) : await framesFromImages(files);
    ctx.source = { kind: 'frames', name: isGif ? files[0].name : `${files.length} pictures`, ...data, duration: data.frames.length, ranges: {} };
    if (data.transparent) { ctx.p.cut.method = ctx.p.cut.method === 'auto' ? 'auto' : ctx.p.cut.method; toast('This footage is already cut out. Its transparency will be used as is.'); }
    view = 'source'; ctx.refresh();
  } catch (e) { toast('Could not read that file: ' + e.message, { error: true }); } finally { ctx.busy(null); }
}

export async function loadSample(ctx) {
  try {
    ctx.busy('Loading the green-screen sample (OpenMortal\'s own Kinga footage)...');
    const video = await loadVideo('samples/kinga-greenscreen.webm');
    ctx.source = { kind: 'video', name: 'kinga-greenscreen.webm (sample)', video, duration: video.duration, ranges: {} };
    // ranges picked by hand from the sample so people can see a full fighter quickly
    ctx.source.ranges = { stance: [14.0, 15.4], walk: [16.0, 18.4], punch: [64.8, 66.0], kick: [71.4, 72.6], crouch: [59.6, 58.4], lowattack: [52.0, 52.8], block: [30.4, 31.2], ouch: [61.4, 62.4], knockdown: [55.6, 57.4], victory: [80.2, 82.6] };
    view = 'source'; ctx.select('pose', 'stance');
    toast('Sample loaded with rough ranges marked for every pose. Press "Use all marked ranges", or adjust each pose first.', { ms: 6000 });
  } catch (e) { toast(e.message, { error: true }); } finally { ctx.busy(null); }
}

function sourceView(ctx, pose) {
  const S = ctx.source, V = ctx.el.viewport;
  const isVideo = S.kind === 'video';
  const max = isVideo ? S.duration : S.frames.length - 1;
  const step = isVideo ? 0.04 : 1;
  let [a, b] = S.ranges[pose.id] || [0, Math.min(max, isVideo ? 1.5 : Math.min(max, 15))];
  const canvas = h('canvas'); const cx = canvas.getContext('2d');
  const W = isVideo ? S.video.videoWidth : S.w, H = isVideo ? S.video.videoHeight : S.h;
  canvas.width = W; canvas.height = H;
  const ghost = h('img', { class: 'ghost', src: `img/guides/${pose.id}.png`, alt: '' });
  const screen = h('div', { class: 'screen', style: { background: 'repeating-conic-gradient(#2f2722 0 25%, #4a3f37 0 50%) 0 0 / 20px 20px' } }, canvas, ghost);
  const pos = h('input', { type: 'range', min: 0, max, step, value: a, 'aria-label': 'Position' });
  const out = h('output', {}); const outA = h('output', {}), outB = h('output', {});
  const bar = h('div', { class: 'rangebar' }, h('i'));
  const count = h('input', { type: 'number', min: 2, max: 40, value: pose.frames, style: { width: '72px' }, 'aria-label': 'Frames to keep' });
  const fmt = t => isVideo ? `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}` : `frame ${Math.round(t) + 1}`;
  const draw = async t => {
    if (isVideo) { await seek(S.video, t); cx.clearRect(0, 0, W, H); cx.drawImage(S.video, 0, 0, W, H); }
    else { cx.clearRect(0, 0, W, H); cx.putImageData(S.frames[Math.round(t)], 0, 0); }
    out.textContent = fmt(t);
  };
  const paintBar = () => { const i = bar.firstChild; i.style.left = (Math.min(a, b) / max * 100) + '%'; i.style.width = Math.max(0.5, Math.abs(b - a) / max * 100) + '%'; outA.textContent = 'start ' + fmt(a); outB.textContent = 'end ' + fmt(b); S.ranges[pose.id] = [a, b]; };
  pos.oninput = () => draw(+pos.value);
  let looping = false;
  const loop = async () => {
    looping = !looping; loopBtn.textContent = looping ? 'Stop' : 'Play the range';
    const n = Math.max(2, +count.value), dt = 1000 / 10;
    for (let k = 0; looping; k = (k + 1) % n) { await draw(a + (b - a) * k / (n - 1)); await new Promise(r => setTimeout(r, dt)); if (!canvas.isConnected) break; }
  };
  const loopBtn = h('button', { class: 'slab small', onclick: loop }, 'Play the range');
  put(V, h('div', { class: 'preview-wrap', style: { width: '100%' } }, screen,
    h('div', { class: 'scrub' },
      h('button', { class: 'slab small', onclick: () => { pos.value = Math.max(0, +pos.value - (isVideo ? 1 / 10 : 1)); draw(+pos.value); }, 'aria-label': 'Step back' }, '<'), pos,
      h('button', { class: 'slab small', onclick: () => { pos.value = Math.min(max, +pos.value + (isVideo ? 1 / 10 : 1)); draw(+pos.value); }, 'aria-label': 'Step forward' }, '>'),
      bar,
      h('div', { class: 'marks' }, out,
        h('button', { class: 'slab small', onclick: () => { a = +pos.value; if (b <= a) b = Math.min(max, a + (isVideo ? 1 : 8)); paintBar(); } }, 'Mark start'),
        h('button', { class: 'slab small', onclick: () => { b = +pos.value; if (a >= b) a = Math.max(0, b - (isVideo ? 1 : 8)); paintBar(); } }, 'Mark end'),
        outA, outB, loopBtn),
      h('div', { class: 'marks' },
        h('label', { class: 'check' }, 'Keep', count, 'frames'),
        h('button', { class: 'slab blood', onclick: () => { looping = false; take(ctx, pose, a, b, +count.value); } }, `Use these frames for ${pose.name}`),
        Object.keys(S.ranges).length > 2 ? h('button', { class: 'slab', onclick: () => takeAll(ctx) }, 'Use all marked ranges') : null))));
  paintBar(); draw(a);
  ctx.refreshFilm();
}

async function grab(S, a, b, n) {
  if (S.kind === 'video') return framesFromVideo(S.video, a, b, n);
  const lo = Math.round(Math.min(a, b)), hi = Math.round(Math.max(a, b));
  let idx = sampleIndices(lo, hi, n); if (a > b) idx = idx.reverse();
  return { w: S.w, h: S.h, frames: idx.map(i => S.frames[i]) };
}

async function take(ctx, pose, a, b, n) {
  const S = ctx.source;
  ctx.busy(`Grabbing ${n} frames for ${pose.name}...`, 0);
  try {
    const data = await grab(S, a, b, n);
    const clip = newClip({ name: pose.name, w: data.w, h: data.h, frames: data.frames, fps: 10, source: S.kind === 'video' ? 'video' : 'gif', alpha: !!S.transparent });
    await finishClip(ctx, pose, clip);
  } finally { ctx.busy(null); }
}

async function takeAll(ctx) {
  const S = ctx.source;
  for (const pose of POSES) {
    const r = S.ranges[pose.id]; if (!r) continue;
    ctx.busy(`Grabbing ${pose.name}...`);
    const data = await grab(S, r[0], r[1], pose.frames);
    const clip = newClip({ name: pose.name, w: data.w, h: data.h, frames: data.frames, fps: 10, source: S.kind === 'video' ? 'video' : 'gif', alpha: !!S.transparent });
    ctx.p.clips[clip.id] = clip; ctx.p.poses[pose.id] = clip.id;
    ctx.busy(`Cutting out ${pose.name}...`, 0);
    await cutClip(clip, ctx.p, { onProgress: v => ctx.busy(`Cutting out ${pose.name}...`, v) });
  }
  ctx.busy(null); ctx.markDirty();
  toast('All marked poses are in and cut out. Check them in step 2.');
  view = null; ctx.refresh();
}

/** Stores a new clip for a pose and runs the automatic cutout straight away. */
async function finishClip(ctx, pose, clip) {
  const old = ctx.p.poses[pose.id]; if (old) delete ctx.p.clips[old];
  ctx.p.clips[clip.id] = clip; ctx.p.poses[pose.id] = clip.id; ctx.markDirty();
  ctx.busy(`Cutting out ${pose.name}...`, 0);
  try { await cutClip(clip, ctx.p, { onProgress: v => ctx.busy(`Cutting out ${pose.name}...`, v) }); }
  catch (e) { toast('Automatic cutout failed: ' + e.message + '. You can paint the mask by hand in step 2.', { error: true }); }
  ctx.busy(null);
  blip('ok');
  view = 'clip'; ctx.refresh();
}

// ---------------------------------------------------------------------------
// A finished pose: looping preview
// ---------------------------------------------------------------------------
function clipView(ctx, pose, clip) {
  const c = h('canvas'); c.width = clip.w; c.height = clip.h;
  const x = c.getContext('2d');
  const screen = h('div', { class: 'screen', style: { background: 'url(img/stages/level1.jpg) center bottom / cover' } }, c);
  put(ctx.el.viewport, h('div', { class: 'preview-wrap' }, screen,
    h('p', { class: 'dim small' }, `${clip.frames.length} frames, cut out with ${methodName(clip.method)}. Fix edges in step 2, add effects in step 3.`),
    h('div', { class: 'row' }, h('button', { class: 'slab', onclick: () => { view = 'choices'; ctx.el.viewport.innerHTML = ''; choicesView(ctx, pose); } }, 'Redo this pose'),
      h('button', { class: 'slab brass', onclick: () => nextPose(ctx) }, 'Next pose'))));
  let i = 0;
  const tick = () => { x.clearRect(0, 0, c.width, c.height); x.drawImage(ctx.frameCanvas(clip, i), 0, 0); i = (i + 1) % clip.frames.length; };
  tick(); anim = setInterval(() => { if (!c.isConnected) return clearInterval(anim); tick(); }, 100);
  ctx.refreshFilm();
}

export function methodName(m) {
  return { ai: 'the AI person cutout', aikey: 'the AI cutout plus green-screen cleanup', aiplate: 'the AI cutout plus your empty-background shot', key: 'the colour key', plate: 'the empty-background shot', 'plate-guess': 'a background guessed from the clip', alpha: 'its own transparency' }[m] || 'nothing yet';
}

// ---------------------------------------------------------------------------
// Borrow a move (mix and match)
// ---------------------------------------------------------------------------
async function borrowView(ctx, pose) {
  const V = ctx.el.viewport;
  put(V, h('div', { class: 'empty' }, h('h1', { class: 'title' }, `Borrow a ${pose.name.toLowerCase()}`),
    h('p', { class: 'dim' }, 'Use this move from a stock OpenMortal fighter or from someone at the arcade. Your other poses stay yours.'),
    h('div', { class: 'choices', id: 'borrowList' }, h('p', { class: 'dim' }, 'Loading fighters...'))));
  ctx.refreshFilm();
  const list = V.querySelector('#borrowList');
  try {
    const fighters = await listBorrowable();
    list.innerHTML = '';
    for (const f of fighters) {
      const b = h('button', { class: 'slab' }, h('img', { src: f.icon, alt: '', width: 64, height: 64, style: { imageRendering: 'auto' } }), f.name, h('small', {}, f.stock ? 'OpenMortal 0.7' : 'made at the arcade'));
      b.onclick = async () => {
        ctx.busy(`Borrowing ${f.name}'s ${pose.name.toLowerCase()}...`);
        try {
          const group = STOCK_GROUP_FOR_POSE[pose.id];
          const data = await borrowMove(f, group);
          const clip = newClip({ name: `${pose.name} (from ${f.name})`, w: data.w, h: data.h, frames: data.frames, fps: 10, source: 'borrow', alpha: true });
          clip.anchor = data.anchor; clip.scale = 1; clip.borrowed = { from: f.name, group };
          await finishClip(ctx, pose, clip);
        } catch (e) { toast(e.message, { error: true }); ctx.busy(null); }
      };
      list.append(b);
    }
  } catch (e) { list.innerHTML = ''; list.append(h('p', {}, 'Borrowing needs the arcade server: ' + e.message)); }
}

// ---------------------------------------------------------------------------
// Hands-on: an animation group selected -> choose exactly which frames feed it
// ---------------------------------------------------------------------------
function mountGroup(ctx) {
  const gid = ctx.sel.group, g = GROUP_BY_ID[gid];
  const refs = resolveGroups(ctx.p)[gid] || [];
  const ov = ctx.p.groups[gid];
  const clips = Object.values(ctx.p.clips);
  const T = ctx.el.tools;
  const first = refs[0] && ctx.p.clips[refs[0].clip];
  const sel = h('select', {}, h('option', { value: '' }, 'Automatic (from the Easy recipe)'), clips.map(c => h('option', { value: c.id, selected: ov && ov.clip === c.id }, c.name)));
  const from = h('input', { type: 'number', min: 1, value: ov ? (ov.from ?? 0) + 1 : 1, style: { width: '70px' } });
  const to = h('input', { type: 'number', min: 1, value: ov ? (ov.to ?? 0) + 1 : (first ? first.frames.length : 1), style: { width: '70px' } });
  const count = h('input', { type: 'number', min: 1, max: 40, value: ov ? ov.count || '' : '', placeholder: 'all', style: { width: '70px' } });
  const rev = h('input', { type: 'checkbox', checked: !!(ov && ov.reverse) });
  const del = h('input', { type: 'number', min: 1, max: 60, value: ctx.p.timing[gid] || g.del, style: { width: '70px' } });
  const apply = () => {
    if (!sel.value) delete ctx.p.groups[gid];
    else { const c = ctx.p.clips[sel.value]; ctx.p.groups[gid] = { clip: sel.value, from: Math.max(0, +from.value - 1), to: Math.min(c.frames.length - 1, Math.max(0, +to.value - 1)), count: +count.value || 0, reverse: rev.checked }; }
    if (+del.value && +del.value !== g.del) ctx.p.timing[gid] = +del.value; else delete ctx.p.timing[gid];
    ctx.markDirty(); ctx.refresh();
  };
  put(T, h('h2', {}, g.label), h('p', { class: 'small dim' }, `Engine name: ${gid}. ${g.need ? 'The game needs at least one frame here.' : 'Optional.'}`),
    h('h3', {}, 'Frames come from'), sel,
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('label', { class: 'field' }, 'First frame', from), h('label', { class: 'field' }, 'Last frame', to), h('label', { class: 'field' }, 'Keep', count)),
    h('label', { class: 'check', style: { marginTop: '6px' } }, rev, 'Play backwards'),
    h('h3', {}, 'Timing'), h('label', { class: 'field' }, 'Game ticks per frame (DEL)', del),
    h('p', { class: 'small dim' }, 'One tick is about 12 ms at normal game speed. Stock fighters use 5 for attacks and 7-8 for idle moves.'),
    h('div', { class: 'row' }, h('button', { class: 'slab brass small', onclick: apply }, 'Apply'), ov ? h('button', { class: 'slab small', onclick: () => { delete ctx.p.groups[gid]; ctx.markDirty(); ctx.refresh(); } }, 'Back to automatic') : null));
  // viewport: animate the group
  const c = h('canvas'); const x = c.getContext('2d');
  put(ctx.el.viewport, h('div', { class: 'preview-wrap' }, h('div', { class: 'screen' }, c),
    h('p', { class: 'dim small' }, refs.length ? `${refs.length} frames at ${ctx.p.timing[gid] || g.del} ticks each.` : 'No footage feeds this animation yet.')));
  if (refs.length) {
    const c0 = ctx.p.clips[refs[0].clip]; c.width = c0.w; c.height = c0.h; let i = 0;
    const tick = () => { const r = refs[i]; const cl = ctx.p.clips[r.clip]; x.clearRect(0, 0, c.width, c.height); x.drawImage(ctx.frameCanvas(cl, r.index), 0, 0); i = (i + 1) % refs.length; };
    tick(); anim = setInterval(() => { if (!c.isConnected) return clearInterval(anim); tick(); }, 12 * (ctx.p.timing[gid] || g.del));
  }
  ctx.refreshFilm();
}
