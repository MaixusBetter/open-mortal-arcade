// lessons.js - Hands-on mode: step-by-step lessons (left tab) and the live fighter script (code tab).
import { h, toast, put } from '../ui.js';
import { buildFighterPl, GROUPS, sanitizeCodename, comboLabel } from '../omformat.js';
import { resolveGroups, groupsMissing } from './state.js';
import { exportGroups, projectileFrames, stanceHeight, clipTransform } from './build.js';

let lessonIndex = 0;
let editing = false;

function currentPl(ctx) {
  const p = ctx.p, g = exportGroups(p);
  const counts = Object.fromEntries(GROUPS.map(x => [x.id, (g[x.id] || []).length]));
  counts.shotdoodad = p.special.kind === 'projectile' ? projectileFrames(p).length : 0;
  return buildFighterPl({
    codename: sanitizeCodename(p.profile.name || 'Fighter'), id: 200, gender: p.profile.gender, counts, timing: p.timing,
    stats: { name: p.profile.name, team: p.profile.team, style: p.profile.style, age: p.profile.age, weight: p.profile.weight, height: p.profile.height, shoe: p.profile.shoe, story: p.profile.story },
    special: p.special.kind === 'strike' && counts.special ? { combo: p.special.combo, hit: 'Uppercut', label: p.special.label, quake: p.special.quake, quakeFrame: 3 } : null,
    projectile: counts.shotdoodad ? { combo: p.special.combo, label: p.special.label, speed: p.projectile.speed, lift: p.projectile.lift, gravity: p.projectile.gravity, w: 48, h: 48 } : null,
    datasize: 0,
  });
}

const LESSONS = [
  {
    title: 'What a fighter is made of',
    body: () => [
      h('p', {}, 'Every OpenMortal fighter is three files in data/characters. You are about to make all three.'),
      h('pre', {}, 'Name.dat      sprites + one 63-colour palette\n              (an Allegro 4 datafile of RLE images)\nName.dat.txt  per frame: offset, head/body/legs\n              boxes, and a hit box on attacks\nName.pl       Perl: animations, moves, states'),
      h('p', {}, 'The game loads every .pl it finds in that folder, so adding a fighter never means changing the game itself. Open the Code tab: that is your Name.pl, rebuilt live as you work.'),
    ],
    mark: /^# .*$/m,
    checks: [],
  },
  {
    title: 'Footage and the cutout',
    body: () => [
      h('p', {}, 'Start with your fighting stance. Film it in step 1, then look at step 2: the background is removed per frame.'),
      h('p', {}, 'Methods, roughly best to worst: a green screen plus the AI cutout, an "empty background" shot from the same camera, the AI on its own. Brush strokes in step 2 override any method.'),
    ],
    checks: [
      { label: 'Stance filmed', test: ctx => !!ctx.p.poses.stance },
      { label: 'Stance cut out', test: ctx => { const c = ctx.p.clips[ctx.p.poses.stance]; return !!(c && c.masks[0]); } },
    ],
    go: ['footage', 'Open step 1'],
  },
  {
    title: 'The anchor, the floor and your size',
    body: () => [
      h('p', {}, 'The game positions a fighter by one point, the anchor. Frame offsets in .dat.txt are measured from it. Stock fighters are about 300 px tall with their feet 290 px below the anchor.'),
      h('p', {}, 'In step 2 the yellow line is your floor and the cyan line your centre. Drag them if a pose drifts. Change the height there too.'),
      h('pre', {}, "@Frames = LoadFrames( \"$codename.dat.txt\", 0, 0 );\n# 0,0 = our offsets are already anchored"),
    ],
    mark: /@Frames = LoadFrames[^\n]*/,
    checks: [
      { label: 'Stance height between 260 and 340 px', test: ctx => { const sh = stanceHeight(ctx.p); const c = ctx.p.clips[ctx.p.poses.stance]; if (!sh || !c) return false; const s = clipTransform(ctx.p, c).scale; return sh * s >= 260 && sh * s <= 340; } },
    ],
    go: ['cutout', 'Open step 2'],
  },
  {
    title: 'Animation groups',
    body: () => [
      h('p', {}, 'CreateFrameLookup lists every animation and how many frames it has, in the order they are stored in the .dat. The engine refers to frames by name, like highpunch3.'),
      h('p', {}, 'Easy mode fills all of these from ten poses. Here you can feed any animation from any clip: pick it in the list on the left (under Basics, Attacks, Getting hit).'),
    ],
    mark: /%FrameLookup = CreateFrameLookup\([\s\S]*?\n\);/,
    checks: [{ label: 'Every required animation has frames', test: ctx => !groupsMissing(ctx.p).length }],
    go: ['footage', 'Pick animations'],
  },
  {
    title: 'States and timing',
    body: () => [
      h('p', {}, 'A state is one frame shown for DEL game ticks (about 12 ms each). @States1 builds states from short sequences:'),
      h('pre', {}, "'+highpunch'   frames 1..n\n'-highpunch'   frames n..1\n'_highpunch'   n-1..1 (skips the repeat)\n'HIT'=>'Highhit'  this attack can hit"),
      h('p', {}, 'Try it: select High punch in the list, set its timing to 4, Apply, and watch the DEL change in the Code tab.'),
    ],
    mark: /\{ 'N'=>'HighPunch'[^\n]*\n[^\n]*/,
    checks: [{ label: 'Changed the timing of any animation', test: ctx => Object.keys(ctx.p.timing).length > 0 }],
  },
  {
    title: 'Hit boxes and collisions',
    body: () => [
      h('p', {}, 'Each frame carries polygons: head, body and legs (where you can be hit) and, on the strongest frame of an attack, hit (your fist or foot).'),
      h('p', {}, 'When an attack state runs, Collision.pl checks your hit polygon against the other fighter\'s head, body and legs. Mortal Arcade places them automatically from your silhouette and picks the frame with the longest reach.'),
      h('p', {}, 'See them: step 5, tick "Hit boxes", and step through a punch.'),
    ],
    checks: [{ label: 'Built the fighter at least once (step 5)', test: ctx => !!ctx.build.result }],
    go: ['test', 'Open step 5'],
  },
  {
    title: 'Special moves and combos',
    body: ctx => [
      h('p', {}, 'The $Con table maps button input to states. Keys read like this: the button, then the directions pressed before it, oldest first.'),
      h('pre', {}, "'hpunchD'  => 'Uppercut'   Down, High punch\n'lkickB'   => 'Sweep'      Back, Low kick\n'lpunchBD' => 'Grenade'    Back, Down, Low punch"),
      h('p', {}, `Your special is ${comboLabel(ctx.p.special.combo)}. Change it in step 4.`),
    ],
    mark: /\$Con = \{[\s\S]*?\n\};/,
    checks: [{ label: 'Gave the special move a name', test: ctx => !!(ctx.p.special.label && ctx.p.special.label !== 'Special') }],
    go: ['profile', 'Open step 4'],
  },
  {
    title: 'Projectiles are doodads',
    body: () => [
      h('p', {}, 'Fireballs in OpenMortal are "doodads". Yours is defined right in your script and uses frames from your own .dat (GFXOWNER 0, starting at FIRSTFRAME).'),
      h('p', {}, 'It spawns at the first corner of the hit polygon on your special pose\'s furthest-reaching frame, so it leaves from your hand.'),
    ],
    mark: /\$Doodad::DoodadDefinitions[\s\S]*?\n\};/,
    checks: [{ label: 'Drew a projectile (step 3, Projectile)', test: ctx => projectileFrames(ctx.p).length > 0 }],
    go: ['paint', 'Open step 3'],
  },
  {
    title: 'Into the real game',
    body: () => [
      h('p', {}, 'RegisterFighter adds you to the roster. Stock fighters use IDs 1-99; contributed ones start at 100, and the arcade hands out 200 and up so nobody collides.'),
      h('p', {}, 'Send to the arcade uploads the three files plus portraits. When the big screen boots, they are copied into C:\\OpenMortal\\data\\characters inside the emulated Windows, next to the stock fighters, and the untouched OpenMortal.exe loads them like any other.'),
    ],
    mark: /::RegisterFighter\([\s\S]*?\n\} \);/,
    checks: [{ label: 'Fighter built and ready to send', test: ctx => !!ctx.build.result && !ctx.build.stale }],
    go: ['test', 'Send it'],
  },
];

export function renderLesson(ctx) {
  const L = ctx.el.lesson; L.innerHTML = '';
  const les = LESSONS[lessonIndex];
  const checks = (les.checks || []).map(c => ({ ...c, ok: (() => { try { return c.test(ctx); } catch { return false; } })() }));
  put(L, h('div', { class: 'lesson' },
    h('div', { class: 'num' }, `Lesson ${lessonIndex + 1} of ${LESSONS.length}`),
    h('h2', {}, les.title),
    ...les.body(ctx),
    checks.length ? h('ul', { class: 'checks' }, checks.map(c => h('li', { class: c.ok ? 'ok' : '' }, c.label))) : null,
    h('div', { class: 'row' },
      les.go ? h('button', { class: 'slab small brass', onclick: () => ctx.go(les.go[0]) }, les.go[1]) : null,
      les.mark ? h('button', { class: 'slab small', onclick: () => ctx.showTab('code') }, 'Show me in the code') : null),
    h('div', { class: 'row', style: { marginTop: '12px', justifyContent: 'space-between' } },
      h('button', { class: 'slab small', disabled: lessonIndex === 0, onclick: () => { lessonIndex--; renderLesson(ctx); renderCode(ctx); } }, 'Previous'),
      h('button', { class: 'slab small', disabled: lessonIndex === LESSONS.length - 1, onclick: () => { lessonIndex++; renderLesson(ctx); renderCode(ctx); } }, 'Next lesson'))));
}

function highlight(code, mark) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const color = s => esc(s)
    .replace(/(^|\n)(#[^\n]*)/g, '$1<span class="c">$2</span>')
    .replace(/('(?:[^'\\\n]|\\.)*')/g, '<span class="s">$1</span>')
    .replace(/\b(sub|my|use|require|return|foreach|unless|if)\b/g, '<span class="k">$1</span>')
    .replace(/(=&gt;\s*)(-?\d+(?:\.\d+)?)/g, '$1<span class="n">$2</span>');
  if (!mark) return color(code);
  const m = mark.exec(code); if (!m) return color(code);
  return color(code.slice(0, m.index)) + '<mark id="lessonMark">' + color(m[0]) + '</mark>' + color(code.slice(m.index + m[0].length));
}

export function renderCode(ctx) {
  const C = ctx.el.code; if (!C || C.hidden && ctx.mode !== 'pro') return;
  C.innerHTML = '';
  const generated = currentPl(ctx);
  const name = sanitizeCodename(ctx.p.profile.name || 'Fighter');
  put(C, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, `${name}.pl`),
    editing ? null : h('button', { class: 'slab small', onclick: () => { editing = true; renderCode(ctx); } }, ctx.p.script ? 'Edit my script' : 'Edit the script')));
  if (editing) {
    const ta = h('textarea', { class: 'code', spellcheck: 'false' }, ctx.p.script || generated);
    put(C, ta, h('div', { class: 'row', style: { marginTop: '6px' } },
      h('button', { class: 'slab small blood', onclick: () => { ctx.p.script = ta.value; editing = false; ctx.markDirty(); toast('Your script will be used when you build. Frame counts still come from your footage.'); renderCode(ctx); } }, 'Use my script'),
      h('button', { class: 'slab small', onclick: () => { editing = false; renderCode(ctx); } }, 'Cancel'),
      ctx.p.script ? h('button', { class: 'slab small', onclick: () => { ctx.p.script = null; editing = false; ctx.markDirty(); renderCode(ctx); } }, 'Back to the generated script') : null),
      h('p', { class: 'small dim' }, 'Careful: if CreateFrameLookup does not match your footage, the game refuses to load the fighter. Build in step 5 to check.'));
    return;
  }
  if (ctx.p.script) put(C, h('p', { class: 'small', style: { color: 'var(--ember)' } }, 'Using your edited script.'));
  const pre = h('div', { class: 'code', html: highlight(ctx.p.script || generated, LESSONS[lessonIndex].mark) });
  put(C, pre, h('p', { class: 'small dim' }, 'Rebuilt live from your footage, timings and profile. This exact file goes into the game.'));
  requestAnimationFrame(() => { const m = pre.querySelector('#lessonMark'); if (m) pre.scrollTop = m.offsetTop - 40; });
}
