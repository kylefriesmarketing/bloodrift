// One-shot roster generator (W2–W5): composes the back-ten character folders from
// PROVEN frame blocks (normals/strings copied from shipped fighters, so the
// advantage lint holds) + hand-specced signature specials per the roster doc.
// Output is plain JSON data — rerun any time; the test harness is the gate.
// Run: node tools/gen-roster.mjs

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const J = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const W = (p, o) => fs.writeFileSync(path.join(root, p), JSON.stringify(o, null, 2) + '\n');

const SRC = {
  zenith: { c: J('data/characters/zenith/character.json'), m: J('data/characters/zenith/moves.json') },
  strigoi: { c: J('data/characters/strigoi/character.json'), m: J('data/characters/strigoi/moves.json') },
  joule: { c: J('data/characters/joule/character.json'), m: J('data/characters/joule/moves.json') }
};
const pick = (src, id) => JSON.parse(JSON.stringify(SRC[src].m.find(m => m.id === id)));

// copy a base kit's normals + first string chain, rescaling damage
function baseKit(src, dmgMul, names) {
  const ids = src === 'joule'
    ? ['s_fp', 's_bp', 's_fk', 's_bk', 'c_fp', 'c_bp', 'c_fk', 'c_bk', 'j_bp', 'j_fk']
    : ['s_fp', 's_bp', 's_fk', 's_bk', 'c_fp', 'c_bp', 'c_fk', 'c_bk', 'j_fp', 'j_bk'];
  const strings = src === 'zenith' ? ['duty_2', 'duty_3']
    : src === 'strigoi' ? ['velvet_2', 'velvet_3']
      : ['site_2', 'site_3'];
  const out = [];
  for (const id of [...ids, ...strings]) {
    const m = pick(src, id);
    m.damage = Math.round(m.damage * dmgMul);
    m.chip = Math.min(m.chip, Math.floor(m.damage * 0.25));
    delete m.lifesteal; delete m.incision; delete m.meterSteal;
    delete m.mastery;
    if (names[id]) m.name = names[id];
    out.push(m);
  }
  return out;
}

// verified special templates (frames come from lint-proven moves)
const T = {
  fireball: (id, name, o = {}) => Object.assign(pick('zenith', 'sunlance'), {
    id, name, input: o.input || 'qcf+FP', variants: undefined, mastery: undefined, tags: o.tags || ['projectile']
  }, o.patch || {}),
  rush: (id, name, o = {}) => Object.assign(pick('strigoi', 'red_line'), {
    id, name, input: o.input || 'b,f+BP', lifesteal: undefined, variants: undefined, tags: o.tags || ['advance']
  }, o.patch || {}),
  grab: (id, name, o = {}) => Object.assign(pick('strigoi', 'cask_slam'), {
    id, name, input: o.input || 'hcb+TH', lifesteal: undefined, variants: undefined, tags: o.tags || ['commandgrab']
  }, o.patch || {}),
  antiair: (id, name, o = {}) => Object.assign(pick('strigoi', 'the_toast'), {
    id, name, input: o.input || 'dp+FP', lifesteal: undefined, tags: o.tags || ['antiair']
  }, o.patch || {}),
  quake: (id, name, o = {}) => Object.assign(pick('joule', 'ground_fault'), {
    id, name, input: o.input || 'qcb+FK', variants: undefined, tags: o.tags || ['low']
  }, o.patch || {}),
  parry: (id, name, o = {}) => Object.assign(pick('zenith', 'corona_guard'), {
    id, name, input: o.input || 'qcb+BP', tags: ['parry']
  }, o.patch || {}),
  odStrike: (id, name, o = {}) => Object.assign(pick('zenith', 'noon'), {
    id, name, input: 'TH+RF (3 pints)', tags: ['overdrive', 'cinematic']
  }, o.patch || {}),
  odSwarm: (id, name, o = {}) => Object.assign(pick('strigoi', 'red_harvest'), {
    id, name, input: 'TH+RF (3 pints)', tags: ['overdrive', 'cinematic']
  }, o.patch || {}),
  teleport: (id, name, o = {}) => ({
    id, name, input: o.input || 'dp+BP', kind: 'special',
    trigger: Object.assign({ type: 'motion', motion: 'dp', button: 'BP', pos: 'stand' }, o.trigger || {}),
    limb_tag: 'BODY', uses: 'BODY', guard: 'mid',
    frames: { startup: 6, active: 2, recovery: 18, hitstop: 0 },
    damage: 0, chip: 0, knock: { type: 'none' },
    movement: [{ frames: [1, 7], vx: o.dist || 42000, passThrough: true }],
    invuln: { frames: [1, 8], vs: 'all' },
    tags: ['teleport']
  }),
  buff: (id, name, o = {}) => ({
    id, name, input: o.input || 'qcb+BP', kind: 'special',
    trigger: Object.assign({ type: 'motion', motion: 'qcb', button: 'BP', pos: 'stand' }, o.trigger || {}),
    limb_tag: 'BODY', uses: 'BODY', guard: 'mid',
    frames: { startup: o.startup || 8, active: 2, recovery: o.recovery || 22, hitstop: 0 },
    damage: 0, chip: 0, knock: { type: 'none' },
    selfBuff: { meterRegen: o.regen || 3, dur: o.dur || 280 },
    tags: ['buff']
  })
};

const stance = (id, name, opts) => ({
  id, name, input: 'hold RF', kind: 'stance',
  trigger: { type: 'rift_hold' },
  limb_tag: 'BODY', uses: 'BODY', guard: 'mid',
  frames: { startup: 5, active: 1, recovery: 10, hitstop: 0 },
  damage: 0, chip: 0, knock: { type: 'none' },
  stance: Object.assign({ enter: 5, exit: 10, absorbProjectiles: true, absorbHeal: 25, armorPool: true }, opts || {}),
  tags: ['stance']
});

const sunder = (region, id, when, desc, flavor) => ({ region, id, when, trigger: { desc }, cinematic: 'TODO', flavor });
const finFile = (character, ex1, ex2, des, od) => ({
  character, note: 'P3 content — the FEED THE RIFT window names executions[0].',
  executions: [
    { id: ex1[0], name: ex1[1], cinematic: 'TODO', script: ex1[2] },
    { id: ex2[0], name: ex2[1], cinematic: 'TODO', script: ex2[2] }
  ],
  desecration: { id: des[0], name: des[1], unlock: des[2], script: des[3] },
  overdrive: { id: od[0], name: od[1], script: od[2] }
});

const CHARS = [
  {
    id: 'centurion', name: 'CENTURION IX', title: 'The Ninth Bearer', faction: 'vanguard',
    archetype: 'stance-loadout', difficulty: 3, base: 'zenith', dmgMul: 1.05,
    stats: { hp: 1080, walkF: 3300, walkB: 2900 },
    mech: {
      mechanic: 'graft_sets',
      config: {
        poolMax: 120, poolStart: 120, absorbHeal: 25, armorDamagePermille: 250,
        power: { dmgPermille: 1000, walkPermille: 930 }, finesse: { walkPermille: 1090, throwStartupMinus: 1, longArmExtend: 0 }
      }
    },
    palette: { primary: '#8a97a8', secondary: '#2c3648', accent: '#c9a227', blood: '#ff2135' },
    names: { s_fp: 'Vanguard Jab', s_bp: 'Era Cross', s_bk: 'Century Round', c_bp: 'Bearer Rise', c_bk: 'Rampart Sweep', duty_2: 'Legacy (2)', duty_3: 'Legacy (ender)' },
    specials: [
      T.fireball('pilum_toss', 'Pilum Toss', { patch: { damage: 65, chip: 13, projectile: { speed: 8500, life: 120, w: 44, h: 18, y: 140, durability: 1 } } }),
      Object.assign(T.rush('shield_rush', 'Shield Rush'), { armor: { frames: [1, 12], hits: 1 }, armorSet: 'power', damage: 70 }),
      T.grab('harvest_trip', 'Harvest Trip', { patch: { damage: 125, grab: { range: 58, cinematicFrames: 40, mashReduce: 3, damageFloor: 95, airOk: false }, knock: { type: 'down', vx: 5200, vy: -8800 } } }),
      T.buff('standard_bearer', 'Standard Bearer', { input: 'dp+FK', trigger: { motion: 'dp', button: 'FK' }, regen: 3, dur: 300 }),
      stance('testudo', 'Testudo'),
      T.odStrike('honor_guard', 'THE HONOR GUARD', { patch: { damage: 250 } })
    ],
    sunders: [
      sunder('ARMS', 'paper_cutter', { type: 'absorb_punish', absorbs: 3 }, 'armor through 3 hits, then punish', 'The Aegis rim comes down on a braced elbow like a paper-cutter.'),
      sunder('LEGS', 'pinned_standard', { type: 'move_hits', move: 'harvest_trip', count: 2 }, 'land the second Harvest Trip', 'The Lance pins a foot to the arena floor — bone-cam of the pin.'),
      sunder('BODY', 'collarbone_hooks', { type: 'move_hits', move: 'shield_rush', count: 3 }, 'land the third Shield Rush', 'Twin Hooks set under the collarbones, and pulled.')
    ],
    fins: finFile('centurion',
      ['tenth_pedestal', 'The Tenth Pedestal', 'The ghosts hold the loser upright while Marcus plants the Lance at parade angle. Stone crawls up, petrifying them mid-defiance — a new statue for the Hall. The camera pulls back: there are many, many more than ten pedestals.'],
      ['changing_guard', 'Changing of the Guard', 'The brass gauntlet of Centurion I, and the ghosts pile in — one punch with eight overlapping after-images takes the torso through the arena wall.'],
      ['muster', 'Muster', 'S-rank Standard Bearer', 'The banner un-plants itself in their chest, and the ghosts salute.'],
      ['honor_guard', 'THE HONOR GUARD', 'All eight prior Centurions manifest in a ring; a century of technique in three seconds, finished with the plain human right cross he had before any of this.'])
  },
  {
    id: 'marrow', name: 'MARROW', title: 'The Ossuary', faction: 'vanguard',
    archetype: 'zoner-crafter', difficulty: 2, base: 'zenith', dmgMul: 0.95,
    stats: { hp: 960 },
    mech: { mechanic: 'rift_special', config: {} },
    palette: { primary: '#ded6c4', secondary: '#6a6152', accent: '#b8434e', blood: '#ff2135' },
    names: { s_fp: 'Knuckle Spur', s_bp: 'Ulna Edge', c_bp: 'Crest Rise', c_bk: 'Femur Sweep', duty_2: 'Ossuary (2)', duty_3: 'Ossuary (ender)' },
    specials: [
      Object.assign(T.fireball('spina', 'Spina', { patch: { damage: 60, chip: 12, projectile: { speed: 9000, life: 120, w: 40, h: 16, y: 140, durability: 1 } } }), { cost: { hp: 8 } }),
      T.rush('vertebral_whip', 'Vertebral Whip', { patch: { damage: 70, movement: undefined, hitboxes: [{ frames: [1, 3], x: 34, y: 150, w: 170, h: 50 }] } }),
      T.quake('gravefield', 'Gravefield', { patch: { damage: 60 } }),
      T.parry('calcify', 'Calcify', { input: 'dp+BP', patch: { trigger: { type: 'motion', motion: 'dp', button: 'BP', pos: 'stand' } } }),
      {
        id: 'reliquary_wall', name: 'Reliquary Wall', input: 'RF', kind: 'special',
        trigger: { type: 'rift_press' }, cooldown: 300,
        limb_tag: 'BODY', uses: 'ARMS', guard: 'mid',
        frames: { startup: 10, active: 1, recovery: 20, hitstun: 18, blockstun: 12, hitstop: 0 },
        damage: 14, chip: 3, meterGain: { hit: 4, block: 1 }, knock: { type: 'none' },
        projectile: { speed: 0, life: 600, w: 46, h: 150, y: 10, durability: 4 },
        tags: ['barricade']
      },
      T.odStrike('cathedral', 'CATHEDRAL', { patch: { damage: 255 } })
    ],
    sunders: [
      sunder('ARMS', 'snapped_cast', { type: 'parry_vs_uses', uses: 'ARMS' }, 'Calcify a punch', 'The counter cases the striking limb in bone — and then she snaps the cast.'),
      sunder('LEGS', 'ascending_spike', { type: 'move_hits', move: 'gravefield', count: 2 }, 'land the second Gravefield', 'A spike through the heel — the bone-cam rides it up.'),
      sunder('BODY', 'spina_volley', { type: 'move_hits', move: 'spina', count: 3 }, 'land the third Spina', 'A point-blank volley the camera follows through.')
    ],
    fins: finFile('marrow',
      ['donor_card', 'Donor Card', 'One open hand, and the skeleton answers — walking them forward one marionette step at a time until it simply steps out and stands beside her like a new recruit. She catalogs it on a wrist-slate.'],
      ['iron_maiden', 'Iron Maiden', 'A gentle push on the sternum, and every bone blooms outward at once in a perfect symmetrical lattice. She circles it once. "Load-bearing. Good bones."'],
      ['restock', 'Restock', 'S-rank Spina', 'The final spear pins them to her Reliquary Wall; she is already walking over to collect her ammunition.'],
      ['cathedral', 'CATHEDRAL', 'A ribvault of colossal bone grows around the opponent and closes like a fist. It crumbles to reveal them crumpled in a rose window of their own blood.'])
  },
  {
    id: 'lycaon', name: 'LYCAON', title: 'The First Wolf', faction: 'court',
    archetype: 'transformer', difficulty: 3, base: 'strigoi', dmgMul: 1.0,
    stats: { hp: 980, walkF: 3700 },
    mech: {
      mechanic: 'graft_sets',
      config: {
        poolMax: 90, poolStart: 90, absorbHeal: 18, armorDamagePermille: 300,
        power: { dmgPermille: 1000, walkPermille: 1000 }, finesse: { walkPermille: 1300, throwStartupMinus: 0, longArmExtend: 0 },
        labels: { power: 'THE MAN', finesse: 'THE BEAST' }
      }
    },
    palette: { primary: '#6a5140', secondary: '#2c2118', accent: '#c9a227', blood: '#8f0f22' },
    names: { s_fp: 'Crown Jab', s_bp: 'Huntsman Cross', c_bk: 'Lope Sweep', velvet_2: 'Pack (2)', velvet_3: 'Pack (ender)' },
    specials: [
      Object.assign(T.rush('kings_measure', "King's Measure", { input: 'b,f+FK', patch: { trigger: { type: 'motion', motion: 'bf', button: 'FK', pos: 'stand' }, damage: 62 } }), { requiresSet: 'power' }),
      Object.assign(T.parry('old_discipline', 'Old Discipline'), { requiresSet: 'power' }),
      Object.assign(T.rush('gutter_run', 'Gutter Run', { input: 'b,f+FK', patch: { trigger: { type: 'motion', motion: 'bf', button: 'FK', pos: 'stand' }, guard: 'low', damage: 58, limb_tag: 'LEGS', hitboxes: [{ frames: [1, 3], x: 30, y: 30, w: 100, h: 44 }] } }), { requiresSet: 'finesse' }),
      Object.assign(T.antiair('throat_answer', 'Throat Answer'), { requiresSet: 'finesse', damage: 68 }),
      Object.assign(T.buff('carrion_call', 'Carrion Call', { input: 'qcb+FK', trigger: { motion: 'qcb', button: 'FK' }, regen: 2, dur: 240 }), { requiresSet: 'finesse' }),
      T.odSwarm('hunt_remembers', 'THE HUNT REMEMBERS', { patch: { damage: 235, lifesteal: 300 } })
    ],
    sunders: [
      sunder('ARMS', 'scientific_rotation', { type: 'parry_vs_uses', uses: 'ARMS' }, 'Old Discipline a punch', 'The counter-fighter takes an over-extended arm and rotates it a scientific, awful amount.'),
      sunder('LEGS', 'ankle_taken', { type: 'move_hits', move: 'gutter_run', count: 3 }, 'third Gutter Run', 'Ankle taken in jaws, shaken.'),
      sunder('BODY', 'bear_trap', { type: 'move_hits', move: 'throat_answer', count: 2 }, 'second Throat Answer', 'Both paws through the guard — a bite the bone-cam frames like a closing bear-trap.')
    ],
    fins: finFile('lycaon',
      ['the_old_way', 'The Old Way', 'Beast form. The pack-ghosts of every wolf he has ever led circle with him — then the screen is all fur and red. He stands at the center, human again, wiping his mouth with a king\'s economy. He always eats first; he never eats alone.'],
      ['wishbone', 'Wishbone', 'One paw on each shoulder, jaws taking the collar. A single shake — the bone-cam shows cervical, and the wide shot completes the thought against the broken moon: make a wish.'],
      ['short_leash', 'Short Leash', 'S-rank Gutter Run', 'The low lope simply doesn\'t stop at the bell — a red streak exits frame, one boot left standing.'],
      ['hunt_remembers', 'THE HUNT REMEMBERS', 'The lights die to moonlight. Three strobe-lit passes, and on the fourth he is simply behind them, resetting his cuffs like a king after a hunt.'])
  },
  {
    id: 'khet', name: 'KHET', title: 'The Ledger of Ages', faction: 'court',
    archetype: 'curse-zoner', difficulty: 3, base: 'zenith', dmgMul: 0.92,
    stats: { hp: 930, walkF: 3200 },
    mech: { mechanic: 'audit', config: { perStack: 14, auditCd: 200 } },
    palette: { primary: '#c2a545', secondary: '#4a3c20', accent: '#3ec6b8', blood: '#8f0f22' },
    names: { s_fp: 'Scribe Jab', s_bp: 'Cartouche Cross', c_bk: 'Sandline Sweep', duty_2: 'Dynasty (2)', duty_3: 'Dynasty (ender)' },
    specials: [
      Object.assign(T.fireball('dry_season', 'Dry Season', { patch: { damage: 58, chip: 12, projectile: { speed: 8000, life: 130, w: 40, h: 20, y: 130, durability: 1 } } }), { incision: true }),
      Object.assign(T.rush('wrapping_writ', 'The Wrapping Writ', { patch: { damage: 60 } }), { incision: true }),
      Object.assign(T.fireball('plague_entry', 'Plague Entry', { input: 'qcb+FK', patch: { trigger: { type: 'motion', motion: 'qcb', button: 'FK', pos: 'stand' }, guard: 'low', limb_tag: 'LEGS', damage: 50, chip: 10, projectile: { speed: 4500, life: 110, w: 50, h: 24, y: 20, durability: 1 } } }), { incision: true }),
      T.teleport('census', 'Census'),
      T.odStrike('dynasty', 'DYNASTY', { patch: { damage: 250 } })
    ],
    sunders: [
      sunder('ARMS', 'aged_wrist', { type: 'move_hits', move: 'dry_season', count: 4 }, 'fourth Dry Season', 'The wrappings take the wrist and age it — four thousand years in four seconds.'),
      sunder('LEGS', 'locked_knee', { type: 'move_hits', move: 'wrapping_writ', count: 2 }, 'second Wrapping Writ', 'Sand liquefies underfoot and refreezes mid-stride; the wrapping-yank resolves the disagreement.'),
      sunder('BODY', 'early_filing', { type: 'hit_while_bleeding' }, 'strike a Bleeding opponent', 'One canopic jar unstoppers and takes its filing early. The jar seals with a stamp.')
    ],
    fins: finFile('khet',
      ['mummification_expedited', 'Mummification, Expedited', 'The wrappings leave him entirely and take the loser standing — four jars, four wet withdrawals, itemized on-screen in hieroglyph receipt-lines. The floor opens and shelves them in a wall of thousands of identical drawers.'],
      ['scarab_estate', 'The Scarab Estate', 'He flicks one scarab at the loser\'s mouth. A held beat — then the swarm exits outward through every seam at once, assembling into a perfect scale model of his pyramid before dispersing.'],
      ['late_fee', 'Late Fee', 'S-rank Audit', 'The detonation keeps compounding past the bell — the numbers still ticking up over the fallen body, itemizing.'],
      ['dynasty', 'DYNASTY', 'The arena floods with sand and his tomb surfaces — four courtier-mummies seize a limb apiece, and the sarcophagus lid closes for one full second of muffled bureaucracy.'])
  },
  {
    id: 'harrow', name: 'HARROW', title: 'The Hollow Rider', faction: 'court',
    archetype: 'trap-puppet', difficulty: 4, base: 'zenith', dmgMul: 1.0,
    stats: { hp: 1000 },
    mech: { mechanic: 'rift_special', config: {} },
    palette: { primary: '#3a3f47', secondary: '#16181d', accent: '#ff9a2b', blood: '#8f0f22' },
    names: { s_fp: 'Gauntlet Jab', s_bp: 'Rider Cross', c_bk: 'Stirrup Sweep', duty_2: 'Toll (2)', duty_3: 'Toll (ender)' },
    specials: [
      T.fireball('deadhead', 'Deadhead', { patch: { damage: 55, chip: 11, projectile: { speed: 3200, life: 240, w: 34, h: 34, y: 60, durability: 3 } } }),
      T.rush('riders_reach', "Rider's Reach", { patch: { damage: 72 } }),
      T.fireball('gallows_calls', 'Gallows Calls', { input: 'dp+FK', patch: { trigger: { type: 'motion', motion: 'dp', button: 'FK', pos: 'stand' }, damage: 90, chip: 18, frames: { startup: 20, active: 1, recovery: 30, hitstun: 30, blockstun: 18, hitstop: 9 }, knock: { type: 'down', vx: 7000 }, projectile: { speed: 16000, life: 120, w: 120, h: 200, y: 20, durability: 3 } } }),
      T.grab('latch', 'Latch', { patch: { damage: 140, grab: { range: 55, cinematicFrames: 44, mashReduce: 3, damageFloor: 110, airOk: false } } }),
      {
        id: 'lantern_toll', name: 'Lantern Toll', input: 'RF', kind: 'special',
        trigger: { type: 'rift_press' }, cooldown: 200,
        limb_tag: 'HEAD', uses: 'BODY', guard: 'mid',
        frames: { startup: 8, active: 4, recovery: 22, hitstun: 26, blockstun: 12, hitstop: 7 },
        damage: 55, chip: 5, meterGain: { hit: 9, block: 3 }, knock: { type: 'launch', vx: 1200, vy: -15500 },
        hitboxes: [{ frames: [1, 4], x: 10, y: 90, w: 90, h: 200 }],
        tags: ['antiair', 'flame']
      },
      T.odSwarm('toll_road', 'THE TOLL ROAD', { patch: { damage: 240 } })
    ],
    sunders: [
      sunder('ARMS', 'fence_post', { type: 'move_hits', move: 'riders_reach', count: 3 }, 'third Rider\'s Reach', 'Saber through the forearm, pinning it to a fence-post that rises from the road-dirt.'),
      sunder('LEGS', 'horse_opinion', { type: 'move_hits', move: 'gallows_calls', count: 2 }, 'second Gallows Calls', 'GALLOWS arrives exactly on cue — a cavalry-horse expressing an opinion about a knee.'),
      sunder('BODY', 'collar_flame', { type: 'move_hits', move: 'latch', count: 2 }, 'second Latch', 'Held to the collar — to the flame — heat where a head\'s worth of it should not fit.')
    ],
    fins: finFile('harrow',
      ['one_more_bandolier', 'One More for the Bandolier', 'He takes the head with the saber in one ceremonial arc and holds it up to his lantern-flame to look at it — the flame has no eyes and it is definitely looking. The others greet it.'],
      ['company', 'Company', 'He doesn\'t take their head cleanly — he swaps it. His body walks off wearing their horrified face; his laughing head rides their stumbling body in circles. The Court finds this one hilarious.'],
      ['kicked_it', 'Kicked It', 'S-rank Deadhead', 'The planted Head, kicked one time too many, simply finishes it — the body still crossing the screen at a sprint, hands out: drop it. Drop it.'],
      ['toll_road', 'THE TOLL ROAD', 'The background becomes a midnight crossroads. GALLOWS makes three full passes, the Head calling the strikes like a carnival barker.'])
  },
  {
    id: 'flux', name: 'FLUX', title: 'The Codex Thief', faction: 'dominion',
    archetype: 'form-cycle', difficulty: 4, base: 'strigoi', dmgMul: 1.0,
    stats: { hp: 940 },
    mech: {
      mechanic: 'graft_sets',
      config: {
        poolMax: 100, poolStart: 100, absorbHeal: 20, armorDamagePermille: 300,
        power: { dmgPermille: 1000, walkPermille: 850 }, finesse: { walkPermille: 1250, throwStartupMinus: 0, longArmExtend: 0 },
        labels: { power: 'KARRAK', finesse: 'VELIX' }
      }
    },
    palette: { primary: '#3a6a72', secondary: '#1a2a30', accent: '#58e8d8', blood: '#2ec8b0' },
    names: { s_fp: 'Salvage Jab', s_bp: 'Core Cross', c_bk: 'Strut Sweep', velvet_2: 'Sequence (2)', velvet_3: 'Sequence (ender)' },
    specials: [
      T.fireball('core_discharge', 'Core Discharge', { patch: { damage: 55, chip: 11, projectile: { speed: 10000, life: 110, w: 36, h: 18, y: 140, durability: 1 } } }),
      Object.assign(T.rush('velix_rake', 'Velix Rake', { input: 'b,f+FP', patch: { trigger: { type: 'motion', motion: 'bf', button: 'FP', pos: 'stand' }, damage: 60 } }), { requiresSet: 'finesse', lifesteal: 150 }),
      Object.assign(T.grab('karrak_shatter', 'Karrak Shatter', { patch: { damage: 165, grab: { range: 58, cinematicFrames: 44, mashReduce: 3, damageFloor: 125, airOk: false } } }), { requiresSet: 'power' }),
      T.fireball('ionne_beam', 'Ionne Beam', { input: 'qcb+BP', patch: { trigger: { type: 'motion', motion: 'qcb', button: 'BP', pos: 'stand' }, damage: 65, chip: 13, projectile: { speed: 14000, life: 90, w: 90, h: 14, y: 150, durability: 1, pierce: true } } }),
      T.teleport('panic_shift', 'Panic Shift', { dist: 36000 }),
      T.odSwarm('full_catalog', 'FULL CATALOG', { patch: { damage: 245 } })
    ],
    sunders: [
      sunder('ARMS', 'numbered_cuts', { type: 'move_hits', move: 'velix_rake', count: 3 }, 'third Velix Rake', 'A six-slash instant the bone-cam only catches up to afterward, numbering the cuts.'),
      sunder('LEGS', 'crushed_to_geometry', { type: 'move_hits', move: 'karrak_shatter', count: 2 }, 'second Karrak Shatter', 'A crystal fist closes around the thigh — the bone faceting.'),
      sunder('BODY', 'light_through', { type: 'move_hits', move: 'ionne_beam', count: 3 }, 'third Ionne Beam', 'A beam threaded through the torso that the camera orbits — light where light should not be.')
    ],
    fins: finFile('flux',
      ['assimilation_error', 'Assimilation Error', 'The SHIFTCORE tries to catalog them — their body cycles helplessly through half-versions of her forms, faster and faster, until the sequences collide. The core chimes politely: sample corrupted. Discarding.'],
      ['field_salvage', 'Field Salvage', 'VELIX form, four cuts, and the loser is disassembled the way she\'d strip a wreck — by resource value. She bags the one glowing sample she wanted. "Nothing personal. Inventory."'],
      ['wrong_form', 'Wrong Form', 'S-rank Panic Shift', 'The defensive shift triggers offensively — their final hit passes through the tear and KARRAK\'s fist comes out of it.'],
      ['full_catalog', 'FULL CATALOG', 'She shifts through every equipped form in 2.5 seconds — VELIX entry, KARRAK wall-splat, IONNE beam finish — ending human, smoking, her gray eye flickering through nine other species\' pupils.'])
  },
  {
    id: 'vespra', name: 'VESPRA', title: 'The Hive Ascendant', faction: 'dominion',
    archetype: 'summoner', difficulty: 3, base: 'zenith', dmgMul: 0.96,
    stats: { hp: 1020, height: 285 },
    mech: { mechanic: 'rift_special', config: {} },
    palette: { primary: '#241a2e', secondary: '#120c18', accent: '#d8a05a', blood: '#8a48c8' },
    names: { s_fp: 'Manipulator Jab', s_bp: 'Blade-Limb Cross', c_bk: 'Chitin Sweep', duty_2: 'Court (2)', duty_3: 'Court (ender)' },
    specials: [
      T.rush('blade_court', 'Blade Court', { input: 'b,f+FP', patch: { trigger: { type: 'motion', motion: 'bf', button: 'FP', pos: 'stand' }, damage: 66 } }),
      T.fireball('acid_lay', 'Acid Lay', { input: 'qcf+FK', patch: { trigger: { type: 'motion', motion: 'qcf', button: 'FK', pos: 'stand' }, guard: 'low', limb_tag: 'LEGS', damage: 40, chip: 8, projectile: { speed: 3000, life: 200, w: 60, h: 22, y: 16, durability: 2 } } }),
      T.antiair('the_lift', 'The Lift', {
        patch: {
          guard: 'throw', damage: 120, chip: 0, invuln: { frames: [1, 10], vs: 'air' },
          frames: { startup: 7, active: 8, recovery: 32, hitstop: 0 }, hitboxes: undefined,
          knock: { type: 'hardDown', vx: 4200, vy: -9800 },
          grab: { range: 72, cinematicFrames: 36, mashReduce: 0, damageFloor: 120, airOk: true, airOnly: true }
        }
      }),
      T.buff('royal_decree', 'Royal Decree', { regen: 3, dur: 240 }),
      {
        id: 'clutch', name: 'Clutch', input: 'RF', kind: 'special',
        trigger: { type: 'rift_press' }, cooldown: 240,
        limb_tag: 'BODY', uses: 'BODY', guard: 'mid',
        frames: { startup: 12, active: 1, recovery: 22, hitstun: 20, blockstun: 13, hitstop: 5 },
        damage: 45, chip: 9, meterGain: { hit: 8, block: 3 }, knock: { type: 'none' },
        projectile: { speed: 2600, life: 300, w: 34, h: 36, y: 24, durability: 2 },
        tags: ['broodling']
      },
      T.odSwarm('swarm_season', 'SWARM SEASON', { patch: { damage: 235 } })
    ],
    sunders: [
      sunder('ARMS', 'hung_from', { type: 'move_hits', move: 'blade_court', count: 3 }, 'third Blade Court', 'Two broodlings hang from the extended arm while a blade-limb comes down precisely at the joint.'),
      sunder('LEGS', 'caliper_care', { type: 'move_hits', move: 'acid_lay', count: 2 }, 'second Acid Lay', 'Acid flash-eats the boot — chitin jaws meet bone with a caliper\'s care.'),
      sunder('BODY', 'thousand_decisions', { type: 'move_hits', move: 'the_lift', count: 2 }, 'second Lift', 'She presses them against her thorax while the larvae mantle swarms across — one bone-camera second of a thousand small decisions.')
    ],
    fins: finFile('vespra',
      ['inheritance', 'Inheritance', 'The brood carries them standing toward the Rift-scar as an honor guard while she explains, in her doubled voice, what an extraordinary gift they are about to become. The brood returns heavier. She counts them home by name.'],
      ['royal_jelly', 'Royal Jelly', 'Two Porters cocoon the loser upright — a shimmering church-window chrysalis. She taps it once, like crystal. It sloshes. The hive drinks; she has, delicately, the first sip.'],
      ['recital', 'Recital', 'S-rank Royal Decree', 'The surge doesn\'t end at the bell — five broodlings mid-leap from five angles, and her four arms beginning, slowly, to applaud.'],
      ['swarm_season', 'SWARM SEASON', 'Every egg hatches at once and the hive arrives — a screen-crossing wave that carries the opponent wall to wall while she watches, a mother at a recital.'])
  },
  {
    id: 'ordnance', name: 'ORDNANCE', title: 'The Field Test', faction: 'dominion',
    archetype: 'artillery', difficulty: 2, base: 'joule', dmgMul: 1.0,
    stats: { hp: 1250, walkF: 2300, walkB: 2100 },
    mech: { mechanic: 'rift_special', config: {} },
    palette: { primary: '#5a6266', secondary: '#23282c', accent: '#58c8e8', blood: '#d8b03a' },
    names: { s_fp: 'Hardpoint Jab', s_bp: 'Chassis Cross', c_bk: 'Tread Sweep', site_2: 'Trial (2)', site_3: 'Trial (ender)' },
    specials: [
      T.fireball('registered_fire', 'Registered Fire', { patch: { damage: 85, chip: 17, frames: { startup: 18, active: 1, recovery: 26, hitstun: 28, blockstun: 16, hitstop: 9 }, knock: { type: 'down', vx: 5200 }, projectile: { speed: 7000, life: 110, w: 46, h: 40, y: 170, durability: 1 } } }),
      T.fireball('cordon', 'Cordon', { input: 'qcb+FK', patch: { trigger: { type: 'motion', motion: 'qcb', button: 'FK', pos: 'stand' }, guard: 'low', limb_tag: 'LEGS', damage: 70, chip: 14, projectile: { speed: 0, life: 400, w: 40, h: 28, y: 14, durability: 1 } } }),
      T.fireball('lance_protocol', 'Lance Protocol', { input: 'b,f+BP', patch: { trigger: { type: 'motion', motion: 'bf', button: 'BP', pos: 'stand' }, damage: 95, chip: 19, frames: { startup: 24, active: 1, recovery: 30, hitstun: 30, blockstun: 20, hitstop: 9 }, knock: { type: 'back', vx: 13000 }, projectile: { speed: 20000, life: 90, w: 110, h: 16, y: 150, durability: 2, pierce: true } } }),
      T.antiair('point_defense', 'Point Defense', { patch: { damage: 72 } }),
      T.buff('salvage', 'Salvage Protocol', { input: 'RF', trigger: { type: 'rift_press' }, regen: 4, dur: 200 }),
      T.odStrike('all_systems', 'ALL SYSTEMS TRIAL', { patch: { damage: 265 } })
    ],
    sunders: [
      sunder('ARMS', 'measured_break', { type: 'move_hits', move: 'lance_protocol', count: 2 }, 'second Lance Protocol', 'The rangefinder measures the break before making it — dotted-line overlay, then compliance.'),
      sunder('LEGS', 'pressure_wave', { type: 'move_hits', move: 'cordon', count: 2 }, 'second Cordon', 'The blast\'s pressure wave crosses a knee in slow motion, annotated.'),
      sunder('BODY', 'contact_trial', { type: 'move_hits', move: 'registered_fire', count: 3 }, 'third Registered Fire', 'The mortar muzzle pressed flat to the chest, filed as contact trial. The annotation is just "✓".')
    ],
    fins: finFile('ordnance',
      ['field_test', 'Field Test', 'Pinned under one enormous foot, prototype rounds cycled one at a time — "Thermic. Effective." (flash) "Flechette. Effective." (flash) "Rift-yield. …Recording." The last result is never shown. "Trial concluded. Recommending adoption."'],
      ['decommissioned', 'Decommissioned', 'It kneels — the only time it kneels — and performs, with terrible gentleness, the exact procedure the Dominion was performing on it when the Rift hit. It arranges the components in regulation configuration, stands, and salutes. Nothing about the salute is programmed. It checked.'],
      ['live_fire', 'Live Fire', 'S-rank Cordon', 'The mine placed at the bell simply proceeds with the trial — the annotation window opening early: TRIAL 413:'],
      ['all_systems', 'ALL SYSTEMS TRIAL', 'Every hardpoint fires in ripple sequence while the rangefinder holds steady-state through the smoke, logging. The final frame stamps: PATTERN 7 — PERFORMS AS DESIGNED.'])
  },
  {
    id: 'null', name: 'NULL', title: 'The Event Horizon', faction: 'dominion',
    archetype: 'gravity-mixup', difficulty: 5, base: 'strigoi', dmgMul: 0.95,
    stats: { hp: 820 },
    mech: { mechanic: 'drain', config: { drinkHeal: 0, drinkMeter: 30, drinkRange: 26 } },
    palette: { primary: '#2a2735', secondary: '#0c0a14', accent: '#7a68c8', blood: '#2ec8b0' },
    names: { s_fp: 'Glove Jab', s_bp: 'Absence Cross', c_bk: 'Horizon Sweep', velvet_2: 'Accretion (2)', velvet_3: 'Accretion (ender)' },
    specials: [
      T.teleport('aperture', 'Aperture', { input: 'qcb+BP', trigger: { motion: 'qcb', button: 'BP' }, dist: 40000 }),
      T.fireball('well', 'Well', { patch: { damage: 50, chip: 10, projectile: { speed: 0, life: 180, w: 56, h: 110, y: 90, durability: 2 } } }),
      T.rush('tidal_hand', 'Tidal Hand', { patch: { damage: 68, movement: undefined, hitboxes: [{ frames: [1, 3], x: 40, y: 150, w: 210, h: 54 }] } }),
      Object.assign(T.antiair('exhale', 'Exhale', { input: 'dp+BP', patch: { trigger: { type: 'motion', motion: 'dp', button: 'BP', pos: 'stand' }, damage: 70 } }), { cost: { meter: 60 } }),
      {
        id: 'consume_grasp', name: 'Consume', input: 'RF', kind: 'special',
        trigger: { type: 'rift_press' }, cooldown: 140,
        limb_tag: 'BODY', uses: 'ARMS', guard: 'mid',
        frames: { startup: 8, active: 2, recovery: 16, hitstun: 16, blockstun: 10, hitstop: 7 },
        onHit: -1, onBlock: -7,
        damage: 20, chip: 4, lifesteal: 1000, meterSteal: 20, meterGain: { hit: 8, block: 2 },
        knock: { type: 'none' },
        hitboxes: [{ frames: [1, 2], x: 20, y: 60, w: 116, h: 200 }],
        tags: ['drain', 'void']
      },
      T.odSwarm('perihelion', 'PERIHELION', { patch: { damage: 245, lifesteal: 400 } })
    ],
    sunders: [
      sunder('ARMS', 'tide_lines', { type: 'move_hits', move: 'tidal_hand', count: 3 }, 'third Tidal Hand', 'Gravity disagrees along the limb\'s length — stress fractures propagating in slow tide-lines.'),
      sunder('LEGS', 'somewhere_else', { type: 'move_hits', move: 'well', count: 2 }, 'second Well', 'A micro-Well at a planted ankle for exactly one step — a knee arriving somewhere the shin hasn\'t.'),
      sunder('BODY', 'learning_tides', { type: 'pools_drunk', drinks: 3 }, 'Consume three pools, then land a hit', 'It embraces them, and the suit\'s chest-tear faces them — ribs learning about tides.')
    ],
    fins: finFile('null',
      ['spaghettification', 'Spaghettification', 'It offers its hand. When they don\'t take it (they never take it), the pull begins at their fingertips — a slow, silent, physically-accurate ribbon crossing the arena in a lazy spiral, entering the dark. The suit closes one button. The boots fall over.'],
      ['the_wastage', 'The Wastage', 'It squeezes first — every drop exits in a shell of red mist that hangs like a second silhouette while the dry husk stands within, still aware. It drinks the silhouette, collapses the husk to a pearl, and files it inside the suit. There are rows of them.'],
      ['closed_system', 'Closed System', 'S-rank Consume', 'Its Consume simply doesn\'t stop at the bell — their final projectile, their last hope, curving mid-flight into the dark with everything else.'],
      ['perihelion', 'PERIHELION', 'It opens the suit. One second of screen-wide pull — then everything returns as one compressed, ringing impact except the fraction it kept. The arena is noticeably cleaner afterward.'])
  },
  {
    id: 'vyrm', name: 'VYRM', title: 'The Wearer', faction: 'dominion',
    archetype: 'body-thief', difficulty: 3, base: 'strigoi', dmgMul: 1.0,
    stats: { hp: 900 },
    mech: { mechanic: 'rift_special', config: {} },
    palette: { primary: '#6a7078', secondary: '#2a2e34', accent: '#b8c8d0', blood: '#8a48c8' },
    names: { s_fp: 'Borrowed Jab', s_bp: 'Half-Beat Cross', c_bk: 'Slack Sweep', velvet_2: 'Wardrobe (2)', velvet_3: 'Wardrobe (ender)' },
    specials: [
      T.rush('borrowed_technique', 'Borrowed Technique', { patch: { damage: 64, frames: { startup: 13, active: 3, recovery: 17, hitstun: 25, blockstun: 12, hitstop: 7 }, onHit: 6, onBlock: -7 } }),
      T.grab('dead_weight', 'Dead Weight', { patch: { damage: 150, grab: { range: 55, cinematicFrames: 42, mashReduce: 3, damageFloor: 115, airOk: false } } }),
      T.fireball('filament_weave', 'Filament Weave', { patch: { damage: 52, chip: 10, projectile: { speed: 9500, life: 70, w: 60, h: 12, y: 140, durability: 1 } } }),
      T.teleport('molt_feint', 'Molt Feint', { dist: 34000 }),
      {
        id: 'maintenance', name: 'Maintenance', input: 'RF', kind: 'special',
        trigger: { type: 'rift_press' }, cooldown: 240, cost: { meter: 50 },
        limb_tag: 'BODY', uses: 'ARMS', guard: 'mid',
        frames: { startup: 8, active: 2, recovery: 24, hitstop: 0 },
        damage: 0, chip: 0, selfHeal: 45, knock: { type: 'none' },
        tags: ['self', 'staples']
      },
      T.odSwarm('test_drive', 'TEST DRIVE', { patch: { damage: 240 } })
    ],
    sunders: [
      sunder('ARMS', 'cable_runners', { type: 'move_hits', move: 'borrowed_technique', count: 3 }, 'third Borrowed Technique', 'Filaments exit the cuff and thread the caught wrist\'s marrow like cable-runners.'),
      sunder('LEGS', 'cannot_keep_frame', { type: 'move_hits', move: 'molt_feint', count: 3 }, 'third Molt Feint', 'Three cuts, one blur — the bone-cam simply cannot keep it in frame, annotated afterward.'),
      sunder('BODY', 'drivers_seat', { type: 'hit_while_bleeding', move: 'dead_weight' }, 'Dead Weight a Bleeding opponent', 'The chest opens from inside — one bone-camera second of the driver\'s seat, occupied, meeting their eyes.')
    ],
    fins: finFile('vyrm',
      ['trade_in', 'Trade-In', 'The neck-collar opens. The camera is merciful about the middle of it — what it holds on is the old host folding to the floor like a coat, and the loser\'s body straightening, checking its new hands with a connoisseur\'s slow delight. It performs their victory pose. Flawlessly. A half-beat late.'],
      ['puppet_show', 'Puppet Show', 'Filaments thread into the fallen loser — and stand them back up. The corpse bows. The corpse performs a shaky pirouette. The corpse walks itself to the arena\'s edge, waves goodbye with both hands, and steps off.'],
      ['repossession', 'Repossession', 'S-rank Latch', 'The back-latch at the bell keeps the merchandise — the opponent\'s body walking away under new management, its portrait replaced by static.'],
      ['test_drive', 'TEST DRIVE', 'The parasite stops pretending — every limb at true spec simultaneously, ignoring joints\' opinions, ending with the host resetting its own shoulders with a staple-gun, panting theatrically. It doesn\'t breathe. The panting is manners.'])
  }
];

const DEBUFFS = {
  ARMS: 'victim punch damage -20%, their throws tech twice as easily',
  LEGS: 'victim loses dashes, move speed -15%',
  BODY: 'victim meter gain -30%, Bleeding applied',
  HEAD: 'victim inputs ghost briefly after every hit taken'
};

for (const spec of CHARS) {
  const src = SRC[spec.base].c;
  const dir = `data/characters/${spec.id}`;
  fs.mkdirSync(path.join(root, dir), { recursive: true });

  const character = {
    id: spec.id, name: spec.name, title: spec.title, faction: spec.faction,
    archetype: spec.archetype, difficulty: spec.difficulty,
    stats: Object.assign(JSON.parse(JSON.stringify(src.stats)), spec.stats),
    rift_button: spec.mech,
    rpg_hook: {
      id: spec.id + '_hook', persistent: true, state: {},
      effects: [{ trigger: 'on_execution', action: 'grant_resource', resource: spec.id + '.harvest', amount: 1, note: 'P4+ signature persistence — see the roster doc for the full hook.' }]
    },
    pool_interactions: [],
    wound_art: { arms: 3, legs: 3, body: 3, head: 3 },
    hurtboxes: JSON.parse(JSON.stringify(src.hurtboxes)),
    throw: JSON.parse(JSON.stringify(src.character ? src.character.throw : src.throw)),
    palette: spec.palette
  };
  W(`${dir}/character.json`, character);

  const moves = [...baseKit(spec.base, spec.dmgMul, spec.names || {}), ...spec.specials];
  W(`${dir}/moves.json`, moves);

  W(`${dir}/sunders.json`, {
    character: spec.id,
    note: 'P3 live — roster triggers adapted onto the generic `when` types (D-018 wave build).',
    sunders: spec.sunders,
    debuffs_reference: DEBUFFS
  });
  W(`${dir}/finishers.json`, spec.fins);
  W(`${dir}/gear.json`, {
    character: spec.id,
    note: 'P4 content — carried in data, ignored by engine v1. See the roster doc for this fighter\'s gear lines.',
    items: []
  });
  console.log('generated', spec.id, `(${moves.length} moves)`);
}
console.log('done — 10 fighters generated');
