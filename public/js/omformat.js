// omformat.js
// OpenMortal 0.7 file formats, written from scratch for the Mortal Arcade creator.
//   * <Codename>.dat      Allegro 4 datafile: one PAL object + one 8-bit RLE sprite per frame
//   * <Codename>.dat.txt  Perl list of frame descriptors (offsets + head/body/legs/hit polygons)
//   * <Codename>.pl       Perl fighter script (frame lookup, move list, states, RegisterFighter)
// Everything here is plain JS with no DOM use, so it runs in the browser and in Node.

// ---------------------------------------------------------------------------
// Animation groups, in the order they are stored in the .dat file.
// "need" = the engine's state machine references this group, so it must have >= 1 frame.
// ---------------------------------------------------------------------------
export const GROUPS = [
  { id: 'start',           label: 'Entrance',            need: 1, del: 5 },
  { id: 'stand',           label: 'Fighting stance',     need: 1, del: 7 },
  { id: 'walk',            label: 'Walk',                need: 1, del: 5 },
  { id: 'turn',            label: 'Turn around',         need: 1, del: 5 },
  { id: 'falling',         label: 'Knocked down',        need: 1, del: 5 },
  { id: 'laying',          label: 'Lying on the floor',  need: 1, del: 1000 },
  { id: 'hurt',            label: 'Hurt',                need: 1, del: 8 },
  { id: 'won',             label: 'Victory',             need: 1, del: 8 },
  { id: 'block',           label: 'Block',               need: 1, del: 5 },
  { id: 'kneeling',        label: 'Crouch down',         need: 1, del: 7 },
  { id: 'onknees',         label: 'Crouching',           need: 1, del: 7 },
  { id: 'kneelingpunch',   label: 'Crouch punch',        need: 1, del: 5 },
  { id: 'kneelingkick',    label: 'Crouch kick',         need: 1, del: 5 },
  { id: 'kneelingpunched', label: 'Hit while crouching (high)', need: 1, del: 5 },
  { id: 'kneelingkicked',  label: 'Hit while crouching (low)',  need: 1, del: 5 },
  { id: 'fun',             label: 'Idle fun',            need: 1, del: 8 },
  { id: 'funb',            label: 'Idle fun 2',          need: 1, del: 8 },
  { id: 'threat',          label: 'Taunt',               need: 1, del: 5 },
  { id: 'highpunch',       label: 'High punch',          need: 1, del: 5, attack: 'punch' },
  { id: 'lowpunch',        label: 'Low punch',           need: 1, del: 5, attack: 'punch' },
  { id: 'highkick',        label: 'High kick',           need: 1, del: 5, attack: 'kick' },
  { id: 'lowkick',         label: 'Low kick',            need: 1, del: 5, attack: 'lowkick' },
  { id: 'groinkick',       label: 'Groin kick',          need: 1, del: 5, attack: 'lowkick' },
  { id: 'kneekick',        label: 'Knee strike',         need: 1, del: 5, attack: 'kick' },
  { id: 'elbow',           label: 'Elbow',               need: 1, del: 5, attack: 'punch' },
  { id: 'spin',            label: 'Spin attack',         need: 1, del: 6, attack: 'kick' },
  { id: 'sweep',           label: 'Leg sweep',           need: 1, del: 6, attack: 'lowkick' },
  { id: 'grenade',         label: 'Projectile throw',    need: 1, del: 5, attack: 'punch' },
  { id: 'uppercut',        label: 'Uppercut',            need: 1, del: 5, attack: 'uppercut' },
  { id: 'throw',           label: 'Throw',               need: 1, del: 8 },
  { id: 'highpunched',     label: 'Hit in the face',     need: 1, del: 8 },
  { id: 'lowpunched',      label: 'Hit in the body',     need: 1, del: 5 },
  { id: 'groinkicked',     label: 'Hit below the belt',  need: 1, del: 7 },
  { id: 'swept',           label: 'Swept off feet',      need: 1, del: 8 },
  { id: 'thrown',          label: 'Thrown',              need: 1, del: 5 },
  { id: 'special',         label: 'Special move',        need: 0, del: 6, attack: 'punch' },
  { id: 'shotdoodad',      label: 'Projectile sprite',   need: 0, del: 5 },
];
export const GROUP_IDS = GROUPS.map(g => g.id);
export const GROUP_BY_ID = Object.fromEntries(GROUPS.map(g => [g.id, g]));

// Standard size conventions measured from the 18 stock fighters:
// standing height ~300 px, feet ~290 px below the anchor, body centred on x = 0.
export const STAND_HEIGHT = 300;
export const FEET_Y = 290;

// Default OpenMortal key bindings (SDLK codes, PLAYER<n>KEY<k>: up, down, left, right, block, lpunch, hpunch, lkick, hkick)
export const KEY_ORDER = ['up', 'down', 'left', 'right', 'block', 'lpunch', 'hpunch', 'lkick', 'hkick'];

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------
class ByteWriter {
  constructor(size = 1 << 20) { this.buf = new Uint8Array(size); this.len = 0; }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let s = this.buf.length * 2; while (s < this.len + n) s *= 2;
    const b = new Uint8Array(s); b.set(this.buf.subarray(0, this.len)); this.buf = b;
  }
  u8(v) { this.ensure(1); this.buf[this.len++] = v & 255; }
  i8(v) { this.u8(v < 0 ? 256 + v : v); }
  u16be(v) { this.ensure(2); this.buf[this.len++] = (v >> 8) & 255; this.buf[this.len++] = v & 255; }
  i16be(v) { this.u16be(v < 0 ? 65536 + v : v); }
  u32be(v) { this.ensure(4); for (let s = 24; s >= 0; s -= 8) this.buf[this.len++] = (v >>> s) & 255; }
  bytes(a) { this.ensure(a.length); this.buf.set(a, this.len); this.len += a.length; }
  ascii(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  result() { return this.buf.slice(0, this.len); }
}

function asciiBytes(s) { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; }

// ---------------------------------------------------------------------------
// Allegro 8-bit RLE sprites. Index 0 is transparent (Allegro MASK_COLOR_8).
// Each row: signed byte n>0 = n literal pixels follow; n<0 = skip -n; 0 = end of row.
// ---------------------------------------------------------------------------
export function encodeRLE8(w, h, px) {
  const out = new ByteWriter(w * h + h * 4 + 16);
  for (let y = 0; y < h; y++) {
    const row = y * w; let x = 0;
    while (x < w) {
      if (px[row + x] === 0) {
        let n = 0; while (x < w && px[row + x] === 0 && n < 127) { x++; n++; }
        out.i8(-n);
      } else {
        let n = 0; const start = x; while (x < w && px[row + x] !== 0 && n < 127) { x++; n++; }
        out.i8(n); out.bytes(px.subarray(row + start, row + start + n));
      }
    }
    out.u8(0);
  }
  return out.result();
}

export function decodeRLE8(w, h, data) {
  const px = new Uint8Array(w * h); let p = 0;
  for (let y = 0; y < h; y++) {
    let x = 0;
    for (;;) {
      let c = data[p++]; if (c > 127) c -= 256;
      if (c > 0) { px.set(data.subarray(p, p + c), y * w + x); p += c; x += c; }
      else if (c < 0) x -= c;
      else break;
    }
  }
  return px;
}

// ---------------------------------------------------------------------------
// Allegro datafile writer/reader ("slh." unpacked file, "ALL." datafile)
// ---------------------------------------------------------------------------
function allegroDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())}-${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function writeProp(w, type, value) {
  const v = asciiBytes(value); w.ascii('prop'); w.ascii(type); w.u32be(v.length); w.bytes(v);
}

/**
 * palette: array of up to 64 [r,g,b] (0-255). Entry 0 is never drawn (transparent).
 * frames:  array of { w, h, px: Uint8Array of palette indices (0 = transparent) }
 */
export function writeDatafile(palette, frames, { date = new Date() } = {}) {
  const w = new ByteWriter(1 << 20);
  const stamp = allegroDate(date);
  w.ascii('slh.'); w.ascii('ALL.'); w.u32be(1 + frames.length);
  // PAL object: 256 entries x (r,g,b,pad) in 6-bit VGA range
  writeProp(w, 'DATE', stamp); writeProp(w, 'NAME', 'COLORS_PCX'); writeProp(w, 'ORIG', 'COLORS.PCX');
  w.ascii('PAL '); w.u32be(1024); w.u32be(1024);
  for (let i = 0; i < 256; i++) {
    const c = palette[i] || [0, 0, 0];
    w.u8(c[0] >> 2); w.u8(c[1] >> 2); w.u8(c[2] >> 2); w.u8(0);
  }
  frames.forEach((f, i) => {
    const rle = encodeRLE8(f.w, f.h, f.px);
    const name = 'FRAME' + String(i).padStart(3, '0');
    writeProp(w, 'DATE', stamp); writeProp(w, 'NAME', name + '_PCX'); writeProp(w, 'ORIG', name + '.pcx');
    const size = 10 + rle.length;
    w.ascii('RLE '); w.u32be(size); w.u32be(size);
    w.i16be(8); w.i16be(f.w); w.i16be(f.h); w.u32be(rle.length); w.bytes(rle);
  });
  return w.result();
}

export function readDatafile(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const str = (o, n) => String.fromCharCode(...u.subarray(o, o + n));
  const be32 = o => ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;
  if (str(0, 4) !== 'slh.' || str(4, 4) !== 'ALL.') throw new Error('Not an unpacked Allegro datafile');
  const n = be32(8); let p = 12;
  let palette = null; const frames = [];
  for (let i = 0; i < n; i++) {
    const props = {};
    while (str(p, 4) === 'prop') { const t = str(p + 4, 4); const sz = be32(p + 8); props[t] = str(p + 12, sz); p += 12 + sz; }
    const type = str(p, 4); const csz = be32(p + 4); p += 12;
    const body = u.subarray(p, p + csz); p += csz;
    if (type === 'PAL ') {
      palette = []; for (let k = 0; k < 256; k++) palette.push([0, 1, 2].map(j => Math.min(255, Math.round(body[k * 4 + j] * 255 / 63))));
    } else if (type === 'RLE ') {
      const fw = (body[2] << 8) | body[3], fh = (body[4] << 8) | body[5];
      const len = ((body[6] << 24) | (body[7] << 16) | (body[8] << 8) | body[9]) >>> 0;
      frames.push({ w: fw, h: fh, px: decodeRLE8(fw, fh, body.subarray(10, 10 + len)), name: props.NAME });
    }
  }
  return { palette, frames };
}

// ---------------------------------------------------------------------------
// .dat.txt frame descriptors. Coordinates are relative to the fighter's anchor
// (we write them already anchored and pass pivot 0,0 to LoadFrames).
// ---------------------------------------------------------------------------
const polyStr = p => '[' + p.map(v => Math.round(v)).join(',') + ',]';
export function buildDatTxt(frames) {
  return frames.map(f => {
    let s = `{ 'x'=>${Math.round(f.x)}, 'y'=>${Math.round(f.y)}, 'w'=>${f.w}, 'h'=>${f.h}, ` +
      `'head'=>${polyStr(f.head)}, 'body'=>${polyStr(f.body)}, 'legs'=>${polyStr(f.legs)}, `;
    if (f.hit) s += `'hit'=>${polyStr(f.hit)}, `;
    return s + `'ex'=>1 },`;
  }).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Perl string helpers
// ---------------------------------------------------------------------------
export function perlQuote(s) {
  // single-quoted Perl string: only \\ and \' are special. Keep it to Latin-1.
  const clean = String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, '');
  return "'" + clean.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

export function sanitizeCodename(s) {
  let c = String(s || '').replace(/[^A-Za-z0-9]/g, '');
  if (!/^[A-Za-z]/.test(c)) c = 'F' + c;
  c = c.slice(0, 16);
  if (c.length < 2) c = 'Fighter';
  return c[0].toUpperCase() + c.slice(1);
}

// Button-combo notation used by OpenMortal: keys are hpunch/lpunch/hkick/lkick,
// followed by a direction history (F = forward, B = back, D = down, U = up), oldest first.
export const COMBO_BUTTONS = ['hpunch', 'lpunch', 'hkick', 'lkick'];

/**
 * Builds the <Codename>.pl fighter script.
 * def = {
 *   codename, id, gender, stats: {name, team, style, age, weight, height, shoe, story, keys},
 *   counts: { groupId: frameCount }    (in GROUPS order, groups with 0 frames are skipped)
 *   timing: { groupId: DEL }           (optional overrides)
 *   special: { combo: 'hpunchFF', hit: 'Uppercut', name: 'SpecialPunch' } | null
 *   projectile: { combo: 'lpunchBD', speed: 48, gravity: 0, w, h, damageType } | null  (needs shotdoodad frames)
 *   releaseFrame: index within 'grenade' group where the projectile spawns (1-based)
 *   datasize: byte length of the .dat
 * }
 */
export function buildFighterPl(def) {
  const C = def.codename;
  const counts = def.counts;
  const del = id => (def.timing && def.timing[id]) || GROUP_BY_ID[id].del;
  const has = id => (counts[id] || 0) > 0;
  const total = GROUP_IDS.reduce((a, id) => a + (counts[id] || 0), 0);
  const lookup = GROUP_IDS.filter(has).map(id => `'${id}', ${counts[id]},`).join('\n');
  const st = def.stats || {};
  const shotName = `${C}Shot`;
  const projectile = def.projectile && has('shotdoodad') && has('grenade');
  const special = def.special && has('special');

  const con = [
    `'forw'=>'Walk',`, `'back'=>'Back',`, `'jump'=>'Jump',`, `'jumpfw'=>'JumpFW',`, `'jumpbw'=>'JumpBW',`,
    `'block'=>'Block',`, `'down'=>'Kneeling',`,
    `'hpunch'=>'HighPunch',`, `'lpunch'=>'LowPunch',`, `'hkick'=>'HighKick',`, `'lkick'=>'LowKick',`,
    `'lkickBF'=>'GroinKick',`, `'lkickF'=>'KneeKick',`, `'hpunchD'=>'Uppercut',`, `'hpunchF'=>'Elbow',`,
    `'hkickB'=>'Spin',`, `'lkickB'=>'Sweep',`,
  ];
  if (projectile) con.push(`'${def.projectile.combo || 'lpunchBD'}'=>'Grenade',`);
  if (special) con.push(`'${def.special.combo || 'hpunchFF'}'=>'Special',`);

  const sp = def.projectile || {};
  const doodadDef = projectile ? `
$Doodad::DoodadDefinitions{'${shotName}'} = {
	'T' => 2,					'HOSTILE' => 1,				'LIFETIME' => -1,
	'SIZE' => [ ${sp.w | 0}, ${sp.h | 0} ],	'SPEED' => [ ${sp.speed ?? 40}, ${-(sp.lift ?? 0)} ],	'ACCEL' => [ 0, ${sp.gravity ?? 0} ],
	'GFXOWNER' => 0,			'FIRSTFRAME' => $FrameLookup{'shotdoodad1'} - 1,	'FRAMES' => ${counts.shotdoodad},
	'SA' => 1/${Math.max(1, sp.animDel || 4)},
};
` : '';

  const grenadeState = projectile
    ? `{ 'N'=>'Grenade',		'DEL'=>${del('grenade')},	'S'=>'+grenade',	'DOODAD'=>'${shotName}', 'SOUND1'=>'PLAYER_THROWS' },`
    : `{ 'N'=>'Grenade',		'DEL'=>${del('grenade')},	'S'=>'+grenade',	'HIT'=>'Hit' },`;
  const specialState = special
    ? `{ 'N'=>'Special',		'DEL'=>${del('special')},	'S'=>'+special',	'HIT'=>'${def.special.hit || 'Uppercut'}'${def.special.quake ? ", 'CODE" + (def.special.quakeFrame || 1) + "'=>'::AddEarthquake(" + (def.special.quake | 0) + ");'" : ''} },`
    : '';

  const keysText = st.keys || [
    'Back HPunch - Spin attack',
    'Back LKick - Leg sweep',
    'Forward LKick - Knee strike',
    'Down, HPunch - Uppercut',
    projectile ? `${comboLabel(def.projectile.combo || 'lpunchBD')} - ${def.projectile.label || 'Projectile'}` : null,
    special ? `${comboLabel(def.special.combo || 'hpunchFF')} - ${def.special.label || 'Special move'}` : null,
  ].filter(Boolean).join('\n');

  return `# ${C}.pl - made with Mortal Arcade (uOttawa Game Development Club)
# Generated fighter script for OpenMortal 0.7. Safe to edit by hand.

require 'DataHelper.pl';
use strict;

sub Load${C}
{
	my ( @Frames, %FrameLookup, %States, $Con, $Con2, @States1, $framedesc, $codename );

$codename = '${C}';

# Frame descriptors are already anchored, so the pivot is (0,0).
@Frames = LoadFrames( "$codename.dat.txt", 0, 0 );
%FrameLookup = CreateFrameLookup( scalar @Frames -1,
${lookup}
);
${doodadDef}
$Con = {
${con.join('\n')}
};

$Con2 = {
'lkick'=>'KneelingKick',
'hkick'=>'KneelingKick',
'hpunch'=>'KneelingUppercut',
'lpunch'=>'KneelingPunch',
};

@States1 = (
# 1. BASIC MOVES

{ 'N'=>'Start',			'DEL'=>${del('start')},	'S'=>'+start' },
{ 'N'=>'Stand',			'DEL'=>${del('stand')},	'S'=>'${counts.stand > 1 ? '+stand,_stand' : '+stand'}', 'CON'=>$Con, 'SITU'=>'Ready' },
{ 'N'=>'Turn',			'DEL'=>${del('turn')},	'S'=>'+turn',	'TURNN'=>1, },
{ 'N'=>'Hurt',			'DEL'=>${del('hurt')},	'S'=>'+hurt,-hurt' },
{ 'N'=>'Won',			'DEL'=>${del('won')},	'S'=>'+won',	'NEXTSTN'=> 'Won2' },
{ 'N'=>'Won2',			'DEL'=>1000,'S'=>'won n',	'NEXTST'=>'Won2', },
{ 'N'=>'Fun',			'DEL'=>${del('fun')},	'S'=>'+fun,-fun', 'CON'=>$Con, 'SITU'=>'Ready' },
{ 'N'=>'Funb',			'DEL'=>${del('funb')},	'S'=>'+funb,-funb', 'CON'=>$Con, 'SITU'=>'Ready' },
{ 'N'=>'Threat',		'DEL'=>${del('threat')},	'S'=>'+threat,-threat', 'CON'=>$Con, 'SITU'=>'Ready' },
WalkingFrames( \\%FrameLookup, \\@Frames, 0, 0, $Con ),
BlockStates( FindLastFrame( \\%FrameLookup, 'block' ), 5 ),
KneelingStates( FindLastFrame( \\%FrameLookup, 'kneeling' ),
	FindLastFrame( \\%FrameLookup, 'onknees' ), ${del('kneeling')}, $Con2 ),
JumpStates( \\%FrameLookup,
	{'lkick'=>'JumpKick', 'hkick'=>'JumpKick',
	'lpunch'=>'JumpPunch', 'hpunch'=>'JumpPunch'} ),

# 2. OFFENSIVE MOVES

{ 'N'=>'KneelingPunch',	'DEL'=>${del('kneelingpunch')},	'S'=>'+kneelingpunch,-kneelingpunch', 'SITU'=>'Crouch',
	'HIT'=>'Hit', 'NEXTSTN'=>'Onknees' },
{ 'N'=>'KneelingKick',	'DEL'=>${del('kneelingkick')},	'S'=>'+kneelingkick,-kneelingkick', 'SITU'=>'Crouch',
	'HIT'=>'Hit', 'NEXTSTN'=>'Onknees' },
{ 'N'=>'KneelingUppercut','DEL'=>${del('uppercut')},	'S'=>'+uppercut',
	'HIT'=>'Uppercut' },
{ 'N'=>'HighPunch',		'DEL'=>${del('highpunch')},	'S'=>'+highpunch,_highpunch',
	'HIT'=>'Highhit' },
{ 'N'=>'LowPunch',		'DEL'=>${del('lowpunch')},	'S'=>'+lowpunch,_lowpunch',
	'HIT'=>'Hit' },
{ 'N'=>'HighKick',		'DEL'=>${del('highkick')},	'S'=>'+highkick,_highkick',
	'HIT'=>'Hit' },
{ 'N'=>'LowKick',		'DEL'=>${del('lowkick')},	'S'=>'+lowkick,_lowkick',
	'HIT'=>'Leghit' },
{ 'N'=>'GroinKick',		'DEL'=>${del('groinkick')},	'S'=>'+groinkick,_groinkick',
	'HIT'=>'Groinhit' },
{ 'N'=>'KneeKick',		'DEL'=>${del('kneekick')},	'S'=>'+kneekick,_kneekick',
	'HIT'=>'Hit' },
{ 'N'=>'Elbow',			'DEL'=>${del('elbow')},	'S'=>'+elbow,_elbow',
	'HIT'=>'Highhit' },
{ 'N'=>'Spin',			'DEL'=>${del('spin')},	'S'=>'+spin',
	'HIT'=>'Hit' },
{ 'N'=>'Sweep',			'DEL'=>${del('sweep')},	'S'=>'+sweep,_sweep',
	'HIT'=>'Hit' },
${grenadeState}
{ 'N'=>'Uppercut',		'DEL'=>${del('uppercut')},	'S'=>'+uppercut',
	'HIT'=>'Uppercut' },
{ 'N'=>'Throw',			'DEL'=>${del('throw')},	'S'=>'+throw' },
${specialState}

# 3. HURT MOVES

{ 'N'=>'Falling',		'DEL'=>${del('falling')},	'S'=>'+falling',
	'DELN'=>500, 'SITU'=>'Falling', },
{ 'N'=>'Laying',		'DEL'=>1000,'S'=>'laying n',
	'SITU'=>'Falling' },
{ 'N'=>'Getup',			'DEL'=>${del('falling')},	'S'=>'${counts.falling > 1 ? '_falling' : 'falling 1'}',
	'SITU'=>'Falling', },
{ 'N'=>'Dead',			'DEL'=>10000, 'S'=>'laying 1',
	'SITU'=>'Falling', 'NEXTST'=>'Dead' },

{ 'N'=>'Swept',			'DEL'=>${del('swept')},	'S'=>'+swept,-swept' },

{ 'N'=>'KneelingPunched', 'DEL'=>${del('kneelingpunched')},	'S'=>'+kneelingpunched',
	'SITU'=>'Crouch', 'NEXTSTN'=>'Onknees' },
{ 'N'=>'KneelingKicked', 'DEL'=>${del('kneelingkicked')},	'S'=>'+kneelingkicked',
	'SITU'=>'Crouch', 'NEXTSTN'=>'Onknees' },

{ 'N'=>'HighPunched',	'DEL'=>${del('highpunched')},	'S'=>'+highpunched,-highpunched' },
{ 'N'=>'LowPunched',	'DEL'=>${del('lowpunched')},	'S'=>'+lowpunched,-lowpunched' },
{ 'N'=>'GroinKicked',	'DEL'=>${del('groinkicked')},	'S'=>'+groinkicked,-groinkicked' },
{ 'N'=>'Thrown',		'DEL'=>${del('thrown')},	'S'=>'+thrown' },
);

foreach $framedesc (@States1)
{
	AddStates( \\%States, \\%FrameLookup, $framedesc );
}

FixStates( \\%FrameLookup, \\%States );

TravelingStates( \\%FrameLookup, \\@Frames, \\%States, "falling", 0, 0 );
TravelingStates( \\%FrameLookup, \\@Frames, \\%States, "won", 0, 0 );

%States = ( FindShorthands( \\%States ), %States );

::RegisterFighter( {
	'ID'			=> ${def.id | 0},
	'GENDER'		=> ${def.gender === 2 ? 2 : 1},
	'DATAVERSION'	=> 1,
	'STARTCODE'		=> sub {},
	'FRAMES'		=> \\@Frames,
	'STATES'		=> \\%States,
	'CODENAME'		=> $codename,
	'DATASIZE'		=> ${def.datasize | 0},
	'GAMEVERSION'	=> 0.7,

	'NAME'		=> ${perlQuote(st.name || C)},
	'TEAM'		=> ${perlQuote(st.team || 'uOttawa Game Dev Club')},
	'STYLE'		=> ${perlQuote(st.style || 'Homebrew-fu')},
	'AGE'		=> ${perlQuote(st.age || '?')},
	'WEIGHT'	=> ${perlQuote(st.weight || '?')},
	'HEIGHT'	=> ${perlQuote(st.height || '?')},
	'SHOE'		=> ${perlQuote(st.shoe || '?')},
	'STORY'		=> ${perlQuote(st.story || 'Made at the uOttawa Game Development Club OpenMortal jam.')},
	'KEYS'		=> ${perlQuote(keysText)},
} );

}

Load${C}();

return 1;
`;
}

export function comboLabel(combo) {
  const m = /^(hpunch|lpunch|hkick|lkick)([FBDU]*)$/.exec(combo || '');
  if (!m) return combo;
  const names = { hpunch: 'HPunch', lpunch: 'LPunch', hkick: 'HKick', lkick: 'LKick' };
  const dirs = { F: 'Forward', B: 'Back', D: 'Down', U: 'Up' };
  return [...m[2]].map(c => dirs[c]).concat(names[m[1]]).join(' ');
}

// Roster helper injected alongside custom fighters: hides the stock fighters that
// have portraits but no playable data (they show up with a red X) so there is room
// on the 5x5 select grid. It does not touch any stock file.
export function buildRosterPl({ hideUnplayable = true } = {}) {
  return `# zzRoster.pl - Mortal Arcade roster tweaks (safe to delete)
# Hides stock fighters that have no playable data, freeing select-screen slots.
${hideUnplayable ? "foreach my $id (keys %::FighterStats) { delete $::FighterStats{$id} unless defined $::FighterStats{$id}->{FRAMES} or -e \"$::CharactersDir/$::FighterStats{$id}->{CODENAME}.pl\"; }" : ''}
return 1;
`;
}

// The OpenMortal.exe.ini the web build ships with (windowed, fixed keys the bridge injects).
export function buildIni({ fullscreen = 0, gameTime = 60, hitPoints = 100, gameSpeed = 12, nick = 'Arcade' } = {}) {
  const lines = [
    'Simple config file openmortal 0.7',
    'NUMPLAYERS=2', 'TEAMMODE=0', 'TEAMSIZE=5', 'TEAMMULTISELECT=0',
    `GAMETIME=${gameTime}`, `HITPOINTS=${hitPoints}`, `GAMESPEED=${gameSpeed}`, `FULLSCREEN=${fullscreen}`,
    'CHANNELS=2', 'MIXINGRATE=22050', 'MIXINGBITS=2', 'MUSICVOLUME=80', 'SOUNDVOLUME=100',
    'LANGUAGE=en', 'LATESTSERVER=apocalypse.rulez.org', 'SERVER=0', `NICK=${nick}`,
    // Player 0 (cursor keys block), Player 1 (WASD block): the stock defaults
    'PLAYER0KEY0=273', 'PLAYER0KEY1=274', 'PLAYER0KEY2=276', 'PLAYER0KEY3=275', 'PLAYER0KEY4=281',
    'PLAYER0KEY5=127', 'PLAYER0KEY6=277', 'PLAYER0KEY7=279', 'PLAYER0KEY8=278',
    'PLAYER1KEY0=119', 'PLAYER1KEY1=115', 'PLAYER1KEY2=97', 'PLAYER1KEY3=100', 'PLAYER1KEY4=120',
    'PLAYER1KEY5=102', 'PLAYER1KEY6=114', 'PLAYER1KEY7=103', 'PLAYER1KEY8=116',
    'PLAYER2KEY0=117', 'PLAYER2KEY1=106', 'PLAYER2KEY2=104', 'PLAYER2KEY3=107', 'PLAYER2KEY4=105',
    'PLAYER2KEY5=98', 'PLAYER2KEY6=110', 'PLAYER2KEY7=109', 'PLAYER2KEY8=44',
    'PLAYER3KEY0=283', 'PLAYER3KEY1=284', 'PLAYER3KEY2=285', 'PLAYER3KEY3=286', 'PLAYER3KEY4=287',
    'PLAYER3KEY5=288', 'PLAYER3KEY6=289', 'PLAYER3KEY7=290', 'PLAYER3KEY8=291',
  ];
  return lines.join('\r\n') + '\r\n';
}

// Stage descriptor (.desc): layer count, then "file" / "x y speed" per layer.
export function buildStageDesc(layers) {
  return [String(layers.length), ...layers.flatMap(l => [l.file, `${l.x | 0} ${l.y | 0} ${(+l.speed).toFixed(3)}`])].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Fighter packs: { 'X.pl': string|bytes, 'X.dat': bytes, ... }. The server uses this to
// give each uploaded fighter a unique codename and ID before injecting it.
// ---------------------------------------------------------------------------
const _dec = typeof TextDecoder !== 'undefined' ? new TextDecoder('latin1') : null;
const _asText = d => (typeof d === 'string' ? d : _dec.decode(d));

export function packCodename(files) {
  const pl = Object.keys(files).find(n => /\.pl$/i.test(n) && !/^zz/i.test(n));
  return pl ? pl.replace(/\.pl$/i, '').split('/').pop() : null;
}

export function readPackInfo(files) {
  const codename = packCodename(files);
  if (!codename) return null;
  const pl = _asText(files[Object.keys(files).find(n => n.split('/').pop() === `${codename}.pl`)]);
  const get = k => { const m = new RegExp(`'${k}'\\s*=>\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(pl); return m ? m[1].replace(/\\(.)/g, '$1') : ''; };
  const id = +((/'ID'\s*=>\s*(\d+)/.exec(pl) || [])[1] || 0);
  return { codename, id, name: get('NAME') || codename, team: get('TEAM'), style: get('STYLE'), story: get('STORY'), keys: get('KEYS') };
}

export function renameFighterPack(files, newCodename, newId) {
  const old = packCodename(files);
  if (!old) throw new Error('No fighter script (.pl) in this pack');
  const C = sanitizeCodename(newCodename);
  const out = {};
  for (const [name, data] of Object.entries(files)) {
    const base = name.split('/').pop();
    if (!base.startsWith(old + '.')) continue;
    const nn = C + base.slice(old.length);
    if (base === `${old}.pl`) {
      let pl = _asText(data);
      pl = pl.replace(new RegExp(`\\$codename\\s*=\\s*'${old}'`), `$codename = '${C}'`)
        .replace(new RegExp(`sub Load${old}\\b`), `sub Load${C}`)
        .replace(new RegExp(`\\bLoad${old}\\(\\);`), `Load${C}();`)
        .replace(new RegExp(`'${old}Shot'`, 'g'), `'${C}Shot'`)
        .replace(/('ID'\s*=>\s*)\d+/, `$1${newId | 0}`);
      out[nn] = pl;
    } else out[nn] = data;
  }
  return { codename: C, files: out };
}
