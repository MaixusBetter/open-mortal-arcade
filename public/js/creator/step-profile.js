// step-profile.js - Step 4: name, bio, special move. Shown on OpenMortal's select and stats screens.
import { h, put } from '../ui.js';
import { SPECIAL_COMBOS } from './state.js';
import { normalizeFrame, makePortraits, autoBoxes } from '../fighterbuild.js';
import { composite } from './cutout.js';
import { clipTransform } from './build.js';

export function unmount() {}

export function mount(ctx) {
  const P = ctx.p.profile, S = ctx.p.special;
  const field = (key, label, attrs = {}) => h('label', { class: 'field' + (attrs.wide ? ' wide' : '') }, label,
    attrs.area ? h('textarea', { maxlength: 600, oninput: e => { P[key] = e.target.value; ctx.markDirty(); } }, P[key] || '')
      : h('input', { type: 'text', value: P[key] || '', maxlength: attrs.max || 40, placeholder: attrs.ph || '', oninput: e => { P[key] = e.target.value; ctx.markDirty(); if (key === 'name') nameOut.textContent = e.target.value || 'Your name'; } }));
  const nameOut = h('span', {}, P.name || 'Your name');
  const hasProjectile = ctx.p.projectile.frames.some(f => f && f.data.some((v, i) => (i & 3) === 3 && v));
  const special = ctx.p.poses.special && ctx.p.clips[ctx.p.poses.special];
  put(ctx.el.viewport, h('form', { class: 'profile', onsubmit: e => e.preventDefault() },
    h('h1', { class: 'title wide' }, 'Fighter profile'),
    h('p', { class: 'dim wide' }, 'This is what OpenMortal shows on its select screen and the fighter stats page. Keep it friendly; it goes on the big screen.'),
    field('name', 'Fighter name', { max: 24, ph: 'Captain Haymaker' }),
    field('style', 'Fighting style', { ph: 'Procrastination-fu' }),
    field('team', 'Team', { ph: 'Good, Evil, or your program' }),
    field('age', 'Age', { max: 12 }),
    field('height', 'Height', { max: 12, ph: '175cm' }),
    field('weight', 'Weight', { max: 12, ph: '70kg' }),
    field('shoe', 'Shoe size', { max: 8 }),
    h('label', { class: 'field' }, 'Voice for grunts', h('select', { onchange: e => { P.gender = +e.target.value; ctx.markDirty(); } }, h('option', { value: 1, selected: P.gender !== 2 }, 'Lower voice'), h('option', { value: 2, selected: P.gender === 2 }, 'Higher voice'))),
    field('story', 'Story (shown on the stats screen)', { area: true, wide: true }),
    h('h2', { class: 'wide', style: { marginTop: '10px' } }, 'Special move'),
    h('label', { class: 'field' }, 'Button combo', h('select', { onchange: e => { S.combo = e.target.value; ctx.markDirty(); } }, SPECIAL_COMBOS.map(c => h('option', { value: c.combo, selected: S.combo === c.combo }, c.label)))),
    h('label', { class: 'field' }, 'Move name', h('input', { type: 'text', value: S.label || '', maxlength: 24, placeholder: 'Haymaker Blast', oninput: e => { S.label = e.target.value; ctx.markDirty(); } })),
    h('label', { class: 'field' }, 'What it does', h('select', { onchange: e => { S.kind = e.target.value; ctx.markDirty(); } },
      h('option', { value: 'projectile', selected: S.kind === 'projectile' }, 'Throws the projectile you drew'),
      h('option', { value: 'strike', selected: S.kind === 'strike' }, 'A big strike that knocks them down'))),
    h('label', { class: 'check', style: { alignSelf: 'end' } }, h('input', { type: 'checkbox', checked: !!S.quake, onchange: e => { S.quake = e.target.checked ? 25 : 0; ctx.markDirty(); } }), 'Shake the screen'),
    h('p', { class: 'small dim wide' }, !special ? 'You have no "Special move" pose, so the move reuses your punch.' : S.kind === 'projectile' && !hasProjectile ? 'You have not drawn a projectile yet: do that in step 3, or pick "A big strike".' : 'Ready. The combo works facing either way.'),
  ));
  // portrait preview in the tools panel
  const T = ctx.el.tools;
  put(T, h('h2', {}, 'Select-screen portrait'));
  const stance = ctx.p.clips[ctx.p.poses.stance];
  if (!stance) { put(T, h('p', { class: 'dim small' }, 'Film your fighting stance to get a portrait.')); }
  else {
    const t = clipTransform(ctx.p, stance);
    const nf = normalizeFrame({ w: stance.w, h: stance.h, rgba: composite(stance, 0).data }, t);
    if (nf) {
      autoBoxes(nf);
      const { icon, full } = makePortraits(nf);
      const toC = (img, scale) => { const c = document.createElement('canvas'); c.width = img.w; c.height = img.h; c.getContext('2d').putImageData(new ImageData(img.rgba, img.w, img.h), 0, 0); c.style.width = img.w * scale + 'px'; return c; };
      put(T, h('div', { class: 'row', style: { alignItems: 'end' } }, toC(icon, 1.6), toC(full, 1)), h('p', { class: 'small dim' }, 'Made from the first frame of your stance.'));
    }
  }
  put(T, h('button', { class: 'slab brass', style: { marginTop: '10px' }, onclick: () => ctx.go('test') }, 'Test and send'));
  ctx.el.film.innerHTML = ''; put(ctx.el.film, h('span', { class: 'hint' }, nameOut, ' is almost ready for the arcade.'));
}
