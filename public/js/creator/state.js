// state.js - the fighter project: poses/clips, cutout settings, paint layers, profile.
import { GROUPS, GROUP_IDS } from '../omformat.js';

// Easy mode poses (Photo Dojo style): one short clip each.
export const POSES = [
  { id: 'stance', name: 'Fighting stance', frames: 6, seconds: 1.6, tip: 'Face right, fists up. Bounce on your toes a little.' },
  { id: 'walk', name: 'Walk', frames: 10, seconds: 1.6, tip: 'March on the spot, still facing right. Swing your arms.' },
  { id: 'punch', name: 'Punch', frames: 6, seconds: 1.2, tip: 'One fast punch at face height, then pull it back.' },
  { id: 'kick', name: 'Kick', frames: 7, seconds: 1.4, tip: 'Kick forward at belly height, then put your foot down.' },
  { id: 'crouch', name: 'Crouch', frames: 4, seconds: 1.0, tip: 'Drop into a low crouch and hold it.' },
  { id: 'lowattack', name: 'Crouching attack', frames: 5, seconds: 1.0, tip: 'Stay low and jab forward.' },
  { id: 'block', name: 'Block', frames: 5, seconds: 1.0, tip: 'Raise both forearms in front of your face.' },
  { id: 'ouch', name: 'Ouch!', frames: 5, seconds: 1.0, tip: 'React like you just took a hit. Lean back.' },
  { id: 'knockdown', name: 'Knockdown', frames: 10, seconds: 2.4, tip: 'Sit down, then lie back slowly. We speed it up, so no need to actually fall.' },
  { id: 'victory', name: 'Victory', frames: 10, seconds: 2.0, tip: 'Celebrate. Arms up, flex, dance.' },
  { id: 'special', name: 'Special move', frames: 8, seconds: 1.6, optional: true, tip: 'Your signature move. Throw a fireball, spin, anything. You can paint the projectile later.' },
];
export const POSE_BY_ID = Object.fromEntries(POSES.map(p => [p.id, p]));

// How Easy-mode poses fill all 35+ animation groups the engine needs ("mix and match" uses the same table).
// Each entry: [poseId, how] where how is 'all' | 'last' | 'first' | 'firsthalf' | 'reverse' | 'crouchhit'
export const RECIPE = {
  start: ['stance', 'all'], stand: ['stance', 'all'], walk: ['walk', 'all'], turn: ['stance', 'firsttwo'],
  falling: ['knockdown', 'all'], laying: ['knockdown', 'last'], hurt: ['ouch', 'all'], won: ['victory', 'all'],
  block: ['block', 'all'], kneeling: ['crouch', 'all'], onknees: ['crouch', 'last'],
  kneelingpunch: ['lowattack', 'all'], kneelingkick: ['lowattack', 'all'],
  kneelingpunched: ['crouch', 'crouchhit'], kneelingkicked: ['crouch', 'crouchhit'],
  fun: ['stance', 'all'], funb: ['victory', 'firsthalf'], threat: ['victory', 'all'],
  highpunch: ['punch', 'all'], lowpunch: ['punch', 'all'], highkick: ['kick', 'all'], lowkick: ['kick', 'all'],
  groinkick: ['kick', 'all'], kneekick: ['kick', 'all'], elbow: ['punch', 'all'], spin: ['kick', 'all'],
  sweep: ['lowattack', 'all'], grenade: ['special|punch', 'all'], uppercut: ['punch', 'all'], throw: ['punch', 'all'],
  highpunched: ['ouch', 'all'], lowpunched: ['ouch', 'all'], groinkicked: ['ouch', 'all'], swept: ['knockdown', 'firsthalf'],
  thrown: ['knockdown', 'all'], special: ['special', 'all'],
};

// Stock fighter group names for "borrow a move" (mix and match)
export const STOCK_GROUP_FOR_POSE = {
  stance: 'stand', walk: 'walk', punch: 'highpunch', kick: 'highkick', crouch: 'kneeling', lowattack: 'kneelingpunch',
  block: 'block', ouch: 'highpunched', knockdown: 'falling', victory: 'won', special: 'grenade',
};

export const SPECIAL_COMBOS = [
  { combo: 'lpunchBD', label: 'Back, Down + Low punch' },
  { combo: 'hpunchFF', label: 'Forward, Forward + High punch' },
  { combo: 'hkickFDB', label: 'Forward, Down, Back + High kick' },
  { combo: 'lkickFB', label: 'Forward, Back + Low kick' },
  { combo: 'hpunchBF', label: 'Back, Forward + High punch' },
];

let uid = 1;
export const newId = p => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

export function newProject() {
  return {
    version: 1,
    mode: 'easy',
    profile: { name: '', style: '', team: 'uOttawa Game Dev Club', age: '', height: '', weight: '', shoe: '', story: '', gender: 1 },
    flip: false,                       // footage faces left -> mirror everything
    scale: null,                       // fighter scale (auto from the stance)
    clips: {},                         // clipId -> Clip
    poses: Object.fromEntries(POSES.map(p => [p.id, null])),   // poseId -> clipId
    groups: {},                        // Hands-on overrides: groupId -> { clip, from, to, count, reverse, pingpong }
    timing: {},                        // groupId -> DEL
    special: { combo: 'lpunchBD', label: 'Special', kind: 'projectile', hit: 'Uppercut' },
    projectile: { frames: [], w: 64, h: 64, speed: 40, lift: 0, gravity: 0 },
    cut: { method: 'auto', sensitivity: 50, keyColor: null, plate: null },
    script: null,                      // Hands-on: hand-edited .pl (null = generated)
    boxes: {},                         // Hands-on: groupId -> [ {head, body, legs, hit} ] manual hit boxes
    lessons: {},                       // lessonId -> done
  };
}

/**
 * Clip: { id, name, w, h, frames: [ImageData], fps, source: 'camera'|'video'|'gif'|'borrow',
 *   masks: [Uint8Array] (auto), edits: [Int8Array|null] (manual keep/remove), paint: [ImageData|null],
 *   anchor: { x, y } (source px: centre line + floor), borrowed?: { from, group } }
 */
export function newClip({ name, w, h, frames, fps = 10, source = 'video', alpha = false }) {
  return { id: newId('c'), name, w, h, frames, fps, source, alpha, masks: frames.map(() => null), edits: frames.map(() => null), paint: frames.map(() => null), anchor: null, scale: null };
}

/** Even-ish sample of n indices from [from, to] */
export function sampleIndices(from, to, n) {
  const len = to - from + 1;
  if (n >= len) return Array.from({ length: len }, (_, i) => from + i);
  return Array.from({ length: n }, (_, i) => from + Math.round(i * (len - 1) / Math.max(1, n - 1)));
}

/** Which clip frames feed each animation group. Returns { groupId: [{ clip, index }] } */
export function resolveGroups(project) {
  const out = {};
  const poseClip = id => { const c = project.poses[id]; return c && project.clips[c] ? project.clips[c] : null; };
  for (const gid of GROUP_IDS) {
    if (gid === 'shotdoodad') continue;
    const ov = project.groups[gid];
    if (ov && project.clips[ov.clip]) {
      const clip = project.clips[ov.clip];
      let idx = sampleIndices(ov.from ?? 0, ov.to ?? clip.frames.length - 1, ov.count || clip.frames.length);
      if (ov.reverse) idx = idx.reverse();
      out[gid] = idx.map(i => ({ clip: clip.id, index: i }));
      continue;
    }
    const r = RECIPE[gid]; if (!r) continue;
    const [poseSpec, how] = r;
    const pose = poseSpec.split('|').find(p => poseClip(p));
    const clip = pose && poseClip(pose);
    if (!clip) continue;
    const n = clip.frames.length; const all = Array.from({ length: n }, (_, i) => i);
    let idx = all;
    if (how === 'last') idx = [n - 1];
    else if (how === 'firsttwo') idx = all.slice(0, Math.min(2, n));
    else if (how === 'firsthalf') idx = all.slice(0, Math.max(1, Math.ceil(n / 2)));
    else if (how === 'crouchhit') idx = n > 1 ? [n - 1, n - 2, n - 1] : [0];
    out[gid] = idx.map(i => ({ clip: clip.id, index: i }));
  }
  return out;
}

export function missingPoses(project) {
  return POSES.filter(p => !p.optional && !(project.poses[p.id] && project.clips[project.poses[p.id]]));
}

export function groupsMissing(project) {
  const g = resolveGroups(project);
  return GROUPS.filter(x => x.need && !(g[x.id] && g[x.id].length));
}

// ---------------------------------------------------------------------------
// Tiny event bus
// ---------------------------------------------------------------------------
export class Store extends EventTarget {
  constructor(project) { super(); this.p = project; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, e => fn(e.detail)); }
}
