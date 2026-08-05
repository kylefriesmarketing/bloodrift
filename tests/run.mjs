// BLOODRIFT test harness — BUILD_PLAN §7. Run:
//   C:\Users\kylef\tools\node\node.exe tests\run.mjs
// Gates: schema validation, frame-data lint, engine purity, determinism, golden combos.

import fs from 'node:fs';
import path from 'node:path';
import { validate } from './validator.mjs';
import {
  root, data, makeSim, masks, hold, press, motion, run, runUntil,
  findEv, countEv, assertEq, assert, B
} from './harness.mjs';
import { Sim } from '../engine/sim/sim.mjs';
import {
  freshProfile, charProf, levelOf, masteryRank, buildMods, hydrateBundle,
  matchDelta, applyDelta
} from '../engine/rpg/profile.mjs';

const results = [];
function t(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message || String(e) }); }
}

const INTRO = 62; // fight phase begins ~frame 60; scripts act after this

// ---------------------------------------------------------------- 1. schemas

const ROSTER = ['zenith', 'graft', 'strigoi'];

t('schema: character.json (roster)', () => {
  const sch = data('data/schema/character.schema.json');
  for (const c of ROSTER) {
    const errs = validate(sch, data(`data/characters/${c}/character.json`));
    assert(errs.length === 0, `${c}: ${errs.join(' | ')}`);
  }
});

t('schema: moves.json (roster)', () => {
  const sch = data('data/schema/moves.schema.json');
  for (const c of ROSTER) {
    const errs = validate(sch, data(`data/characters/${c}/moves.json`));
    assert(errs.length === 0, `${c}: ${errs.join(' | ')}`);
  }
});

t('schema: balance + arena', () => {
  let errs = validate(data('data/schema/balance.schema.json'), data('data/balance/core.json'));
  assert(errs.length === 0, 'balance: ' + errs.join(' | '));
  errs = validate(data('data/schema/arena.schema.json'), data('data/arenas/riftscar.json'));
  assert(errs.length === 0, 'arena: ' + errs.join(' | '));
});

// ---------------------------------------------------------------- 2. frame-data lint

t('lint: frame data honest + guardrails', () => {
  const problems = [];
  for (const c of ROSTER) {
    const moves = data(`data/characters/${c}/moves.json`);
    const ids = new Set();
    for (const m of moves) {
      const tag = `${c}/${m.id}`;
      if (ids.has(m.id)) problems.push(`${tag}: duplicate id`);
      ids.add(m.id);
      const fr = m.frames;
      const isAir = m.trigger.pos === 'air';
      const isGrab = !!m.grab || m.guard === 'throw';
      const isProj = !!m.projectile;
      const isStance = m.kind === 'stance';
      const strike = !isGrab && !isProj && !isStance && (m.damage || 0) > 0;

      // nominal advantage honesty (DECISIONS D-003)
      if (strike && !isAir && fr) {
        const base = (fr.active - 1) + fr.recovery;
        if ((!m.knock || m.knock.type === 'none') && m.onHit !== undefined) {
          if (m.onHit !== fr.hitstun - base) problems.push(`${tag}: onHit ${m.onHit} != hitstun-(active-1+recovery) = ${fr.hitstun - base}`);
        }
        if (m.onBlock !== undefined && fr.blockstun !== undefined) {
          if (m.onBlock !== fr.blockstun - base) problems.push(`${tag}: onBlock ${m.onBlock} != blockstun-(active-1+recovery) = ${fr.blockstun - base}`);
        }
      }
      // no free plus-on-block launcher
      if ((m.onBlock || 0) > 0 && m.knock && ['launch', 'groundBounce'].includes(m.knock.type) && !m.cost) {
        problems.push(`${tag}: plus-on-block launcher with no cost`);
      }
      // chip cap
      if ((m.damage || 0) > 0 && (m.chip || 0) > Math.floor(m.damage * 0.25)) {
        problems.push(`${tag}: chip ${m.chip} > 25% of ${m.damage}`);
      }
      // heavies can't be jab-fast
      if (strike && !isGrab && (m.damage || 0) >= 70 && fr.startup < 6) {
        problems.push(`${tag}: damage ${m.damage} with startup ${fr.startup} < 6`);
      }
      // strikes must have hitboxes covering every active frame
      if (strike && !isProj) {
        for (let af = 1; af <= fr.active; af++) {
          if (!(m.hitboxes || []).some(hb => af >= hb.frames[0] && af <= hb.frames[1])) {
            problems.push(`${tag}: active frame ${af} has no hitbox`);
            break;
          }
        }
      }
      // chains reference real moves
      if (m.trigger.type === 'chain' && !moves.some(x => x.id === m.trigger.from)) {
        problems.push(`${tag}: chain from unknown move ${m.trigger.from}`);
      }
      // projectile sanity
      if (isProj && ((m.projectile.durability || 1) < 1 || m.projectile.life < 10)) {
        problems.push(`${tag}: projectile durability/life out of bounds`);
      }
    }
  }
  assert(problems.length === 0, problems.join(' | '));
});

// ---------------------------------------------------------------- 3. engine purity

t('purity: no Math.random inside engine/sim', () => {
  const dir = path.join(root, 'engine', 'sim');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert(!src.includes('Math.random'), `${f} uses Math.random`);
  }
});

// ---------------------------------------------------------------- 4. goldens

t('golden: walk-up jab (damage/meter/trauma ledger)', () => {
  const sim = makeSim();
  const [m0, m1] = masks(320);
  hold(m0, INTRO, 205, B.R);
  press(m0, 214, B.FP);
  const evs = run(sim, m0, m1, 320);
  const hit = findEv(evs, 'hit');
  assert(hit, 'jab never landed');
  assertEq(hit.dmg, 30, 'jab damage');
  assertEq(sim.fighters[1].hp, 1120, 'graft hp');
  assertEq(sim.fighters[0].meter, 5, 'zenith meter (hit gain)');
  assertEq(sim.fighters[1].meter, 2, 'graft meter (damage taken)');
  assertEq(sim.fighters[1].trauma.HEAD, 30, 'HEAD trauma');
});

t('golden: Duty string (dial chain + combo scaling)', () => {
  const sim = makeSim();
  const [m0, m1] = masks(420);
  hold(m0, INTRO, 205, B.R);
  press(m0, 214, B.FP);
  press(m0, 226, B.FP);
  press(m0, 240, B.BP);
  const evs = run(sim, m0, m1, 420);
  assertEq(countEv(evs, 'hit'), 3, 'string hits');
  // 30 + 25 + trunc(55*0.9) = 30+25+49
  assertEq(sim.fighters[1].hp, 1150 - 104, 'graft hp after scaled string');
  assertEq(sim.fighters[0].meter, 17, 'zenith meter');
  assertEq(sim.fighters[1].trauma.HEAD, 55, 'HEAD trauma');
  assertEq(sim.fighters[1].trauma.BODY, 49, 'BODY trauma (scaled hit)');
});

t('golden: Sunlance (projectile + pool spawn)', () => {
  const sim = makeSim();
  const [m0, m1] = masks(300);
  motion(m0, 70, 'qcf', B.FP, 1);
  const got = runUntil(sim, m0, m1, 300, 'hit'); // assert AT the hit, before pool ticking starts
  assert(got, 'sunlance never landed');
  assertEq(got.ev.dmg, 70, 'sunlance damage');
  assertEq(sim.fighters[1].hp, 1080, 'graft hp');
  assertEq(sim.fighters[0].meter, 12, 'zenith meter gain');
  assertEq(sim.fighters[1].meter, 5, 'graft meter (taken)');
  assertEq(sim.fighters[1].trauma.ARMS, 70, 'ARMS trauma (sunlance limb tag)');
  assert(sim.pools.length >= 1, 'heavy hit left a pool');
});

t('golden: EX Sunlance (1 pint, 90 damage)', () => {
  const sim = makeSim({ startMeter: [100, 0] });
  const [m0, m1] = masks(300);
  motion(m0, 70, 'qcf', B.FP, 1, B.BL);
  const evs = run(sim, m0, m1, 300);
  assert(findEv(evs, 'ex'), 'EX not triggered');
  const hit = findEv(evs, 'hit');
  assertEq(hit.dmg, 90, 'EX damage');
  assertEq(sim.fighters[0].meter, 12, 'meter: 100 spent, +12 on hit');
  assertEq(sim.fighters[1].hp, 1060, 'graft hp');
});

t('golden: Flared Sunlance (Solar Debt, ignite burn, knockdown)', () => {
  const sim = makeSim();
  const [m0, m1] = masks(420);
  motion(m0, 70, 'qcf', B.FP, 1, B.RF);
  const evs = run(sim, m0, m1, 420);
  assert(findEv(evs, 'flare'), 'flare not triggered');
  const hit = findEv(evs, 'hit');
  assertEq(hit.dmg, 95, 'flare damage');
  assertEq(sim.fighters[0].debt, 10, 'solar debt banked');
  assertEq(sim.fighters[0].meter, 12, 'flare costs no meter');
  assertEq(sim.fighters[1].hp, 1150 - 95 - 18, 'burn dealt full 18 over 90f');
});

t('golden: universal throw connects (130) and techs clean', () => {
  // no tech
  let sim = makeSim();
  let [m0, m1] = masks(320);
  hold(m0, INTRO, 205, B.R);
  press(m0, 214, B.TH);
  let evs = run(sim, m0, m1, 320);
  assert(findEv(evs, 'grabConnect'), 'throw never connected');
  const gh = findEv(evs, 'grabHit');
  assert(gh, 'throw never resolved');
  assertEq(gh.dmg, 130, 'throw damage');
  assertEq(sim.fighters[1].hp, 1020, 'graft hp');
  // tech
  sim = makeSim();
  [m0, m1] = masks(320);
  hold(m0, INTRO, 205, B.R);
  press(m0, 214, B.TH);
  press(m1, 224, B.TH);
  evs = run(sim, m0, m1, 320);
  assert(findEv(evs, 'throwTech'), 'tech did not happen');
  assert(!findEv(evs, 'grabHit'), 'teched throw still did damage');
  assertEq(sim.fighters[1].hp, 1150, 'graft hp untouched after tech');
});

t('golden: Fitting command grab + mash resist floor', () => {
  // clean: 170
  let sim = makeSim();
  let [m0, m1] = masks(400);
  hold(m1, INTRO, 235, B.L);
  motion(m1, 244, 'hcb', B.TH, -1);
  let evs = run(sim, m0, m1, 400);
  let gh = findEv(evs, 'grabHit');
  assert(gh, 'fitting never landed');
  assertEq(gh.dmg, 170, 'fitting clean damage');
  assertEq(sim.fighters[0].hp, 830, 'zenith hp');
  // mashed to the floor: 130
  sim = makeSim();
  [m0, m1] = masks(400);
  hold(m1, INTRO, 235, B.L);
  motion(m1, 244, 'hcb', B.TH, -1);
  for (let f = 256; f < 330; f += 4) press(m0, f, B.FP);
  evs = run(sim, m0, m1, 400);
  gh = findEv(evs, 'grabHit');
  assert(gh, 'fitting (mash) never landed');
  assertEq(gh.dmg, 130, 'fitting mashed to damage floor');
  assertEq(sim.fighters[0].hp, 870, 'zenith hp after mash');
});

t('golden: blood pool ticks meter (amplified on the Rift-Scar)', () => {
  const sim = makeSim();
  const [m0, m1] = masks(300);
  motion(m0, 70, 'qcf', B.FP, 1);
  const got = runUntil(sim, m0, m1, 300, 'hit');
  assert(got, 'setup hit missing');
  const evs = run(sim, null, null, 132);
  assertEq(countEv(evs.filter(e => e.who === 1), 'poolTick'), 4, 'pool ticks in window');
  // 5 (damage taken) + 4 ticks * (2 * 1500/1000 = 3)
  assertEq(sim.fighters[1].meter, 17, 'graft meter after standing in his own blood');
});

t('golden: Corona Guard parry (refund + no damage)', () => {
  const sim = makeSim();
  const [m0, m1] = masks(300);
  hold(m0, INTRO, 148, B.R);
  hold(m1, INTRO, 148, B.L);
  motion(m0, 150, 'qcb', B.BP, 1);
  press(m1, 158, B.FP);
  const evs = run(sim, m0, m1, 300);
  assert(findEv(evs, 'parry'), 'parry did not trigger');
  assertEq(sim.fighters[0].hp, 1000, 'zenith untouched');
  assertEq(sim.fighters[0].meter, 50, 'parry refund (no debt → +0.5 pint)');
  assert(!findEv(evs, 'hit'), 'no hit should have landed');
});

t('golden: Meat Wall absorbs projectiles', () => {
  const sim = makeSim();
  const [m0, m1] = masks(300);
  hold(m1, 70, 280, B.RF);
  motion(m0, 100, 'qcf', B.FP, 1);
  const evs = run(sim, m0, m1, 300);
  assert(findEv(evs, 'stanceEnter'), 'stance never entered');
  assert(findEv(evs, 'absorb'), 'projectile not absorbed');
  assert(!findEv(evs, 'hit'), 'projectile should not hit');
  assertEq(sim.fighters[1].hp, 1150, 'graft untouched');
  assertEq(sim.fighters[1].graftHp, 150, 'graft pool at cap');
});

t('golden: Overdrive NOON (3 pints, superflash, 260)', () => {
  let sim = makeSim({ startMeter: [300, 0] });
  let [m0, m1] = masks(300);
  hold(m0, 70, 74, B.TH | B.RF);
  let evs = run(sim, m0, m1, 300);
  assert(findEv(evs, 'overdrive'), 'overdrive not fired');
  const hit = findEv(evs, 'hit');
  assert(hit, 'NOON whiffed');
  assertEq(hit.dmg, 260, 'NOON damage');
  assertEq(sim.fighters[1].hp, 890, 'graft hp');
  assertEq(sim.fighters[0].meter, 0, 'meter fully spent');
  // blocked: heavy chip
  sim = makeSim({ startMeter: [300, 0] });
  [m0, m1] = masks(300);
  hold(m0, 70, 74, B.TH | B.RF);
  hold(m1, INTRO, 299, B.BL);
  evs = run(sim, m0, m1, 300);
  assert(findEv(evs, 'block'), 'NOON not blocked');
  assertEq(sim.fighters[1].hp, 1090, 'chip 60 through block');
});

t('golden: Bleed-out KO (bleed ignores the chip clamp)', () => {
  const sim = makeSim();
  run(sim, null, null, 70);
  sim.fighters[1].hp = 40;
  sim.fighters[1].bleedRegions = ['ARMS', 'BODY'];
  const got = runUntil(sim, null, null, 200, 'roundEnd');
  assert(got, 'bleed-out never concluded');
  assertEq(got.ev.reason, 'bleedout', 'round end reason');
  assertEq(got.ev.winner, 0, 'zenith wins by bleed-out');
});

t('golden: chip cannot KO (clamps at 1 hp)', () => {
  const sim = makeSim();
  run(sim, null, null, 70);
  sim.fighters[1].hp = 10;
  const [m0, m1] = masks(300);
  hold(m1, 0, 299, B.BL);
  motion(m0, 20, 'qcf', B.FP, 1);
  const evs = run(sim, m0, m1, 300);
  assert(findEv(evs, 'block'), 'sunlance not blocked');
  assertEq(sim.fighters[1].hp, 1, 'chip clamped at 1');
  assertEq(sim.phase, 'fight', 'round must not end on chip');
});

// ---------------------------------------------------------------- 4b. P3 — sunders + finish

t('schema: sunders.json (roster)', () => {
  const sch = data('data/schema/sunders.schema.json');
  for (const c of ROSTER) {
    const errs = validate(sch, data(`data/characters/${c}/sunders.json`));
    assert(errs.length === 0, `${c}: ${errs.join(' | ')}`);
  }
});

t('sunder: Corona parry of a punch sunders GRAFT\'s ARMS (then -20% punch damage)', () => {
  const sim = makeSim();
  const [m0, m1] = masks(420);
  hold(m0, INTRO, 148, B.R);
  hold(m1, INTRO, 148, B.L);
  motion(m0, 150, 'qcb', B.BP, 1);
  press(m1, 158, B.FP);          // parried punch → boiled_grip
  hold(m1, 262, 318, B.L);       // walk all the way back in after the knockdown
  press(m1, 324, B.FP);          // broken-arm jab
  const evs = run(sim, m0, m1, 420);
  const sd = findEv(evs, 'sunder');
  assert(sd, 'sunder never fired');
  assertEq(sd.region, 'ARMS', 'sundered region');
  assertEq(sd.who, 1, 'graft is the victim');
  assert(sim.fighters[1].sundered.ARMS, 'sundered flag set');
  const hit = findEv(evs, 'hit', e => e.by === 1);
  assert(hit, 'post-sunder jab never landed');
  assertEq(hit.dmg, 32, 'punch damage reduced 40 → 32');
});

t('sunder: second Fitting sunders ARMS; ZENITH\'s Sunlance drops 70 → 56', () => {
  const sim = makeSim();
  const [m0, m1] = masks(700);
  hold(m1, INTRO, 235, B.L);
  motion(m1, 244, 'hcb', B.TH, -1);   // fitting #1
  hold(m1, 340, 392, B.L);            // walk the flung ZENITH back down
  motion(m1, 398, 'hcb', B.TH, -1);   // fitting #2 (after his wakeup) → found_wanting
  motion(m0, 600, 'qcf', B.FP, 1);    // broken-arm sunlance, after his wakeup
  const evs = run(sim, m0, m1, 760);
  assertEq(countEv(evs, 'grabHit'), 2, 'both fittings landed');
  const sd = findEv(evs, 'sunder');
  assert(sd, 'sunder never fired');
  assertEq(sd.region, 'ARMS', 'region');
  assertEq(sd.who, 0, 'zenith is the victim');
  const lance = findEv(evs, 'hit', e => e.move === 'sunlance');
  assert(lance, 'sunlance never landed');
  assertEq(lance.dmg, 56, 'ARMS-sundered sunlance damage');
});

t('sunder debuff: LEGS = -15% walk and no dashes (exact integer math)', () => {
  const sim = makeSim();
  run(sim, null, null, 70);
  const g = sim.fighters[1];
  g.sundered.LEGS = true;
  const x0 = g.x;
  const [m0, m1] = masks(100);
  hold(m1, 0, 99, B.L);
  run(sim, m0, m1, 100);
  // power set 900‰, LEGS 850‰ → trunc(2950 * trunc(900*850/1000) / 1000) = 2256 millipx/frame
  assertEq(x0 - g.x, 225600, 'walk distance over 100 frames');
});

t('sunder debuff: BODY = meter gain -30%', () => {
  const sim = makeSim();
  run(sim, null, null, 70);
  sim.fighters[0].sundered.BODY = true;
  const [m0, m1] = masks(300);
  hold(m1, 0, 170, B.L);
  press(m1, 180, B.FP);
  const evs = run(sim, m0, m1, 300);
  assert(findEv(evs, 'hit'), 'jab never landed');
  assertEq(sim.fighters[0].meter, 2, 'victim meter gain 3 → 2 under BODY sunder');
  assertEq(sim.fighters[1].meter, 5, 'attacker unaffected');
});

t('finish: FEED THE RIFT — execution path (Rift press) and spare path (timeout)', () => {
  const playToPrompt = () => {
    const sim = makeSim();
    const [m0, m1] = masks(400);
    hold(m0, INTRO, 205, B.R);
    press(m0, 214, B.FP);
    run(sim, m0, m1, 260);
    sim.roundWins[0] = 1;          // harness liberty: this KO closes the match
    sim.fighters[1].hp = 5;
    const [m2] = masks(400);
    press(m2, 10, B.FP);
    const evs = run(sim, m2, null, 240, s => s.phase === 'finish');
    assert(findEv(evs, 'finishPrompt') || sim.phase === 'finish', 'finish phase never reached');
    return sim;
  };
  // execute
  let sim = playToPrompt();
  let evs = run(sim, [0, 0, 0, 0, 0, B.RF], null, 6);
  evs = evs.concat(run(sim, null, null, 200));
  const ex = findEv(evs, 'execution');
  assert(ex, 'execution never fired');
  assertEq(ex.name, 'Dawn, Once More', 'execution name from finishers.json');
  assert(sim.matchOver, 'match should be over after execution');
  assertEq(sim.winner, 0, 'zenith wins');
  // spare
  sim = playToPrompt();
  evs = run(sim, null, null, 520);
  assert(findEv(evs, 'spared'), 'spare never fired');
  assert(sim.matchOver, 'match should be over after sparing');
});

// ---------------------------------------------------------------- 4c. STRIGOI (Wave 1 opener)

t('strigoi: Sanguine Draw tether — lifesteal + meter theft, exact numbers', () => {
  const sim = makeSim({ p1: 'strigoi', p2: 'graft', startMeter: [0, 50] });
  run(sim, null, null, 70);
  sim.fighters[0].hp = 700;
  const [m0, m1] = masks(300);
  hold(m0, 0, 145, B.R);
  press(m0, 154, B.RF);
  const evs = run(sim, m0, m1, 300);
  const hit = findEv(evs, 'hit', e => e.move === 'sanguine_draw');
  assert(hit, 'tether never landed');
  assertEq(hit.dmg, 25, 'tether damage');
  const dr = findEv(evs, 'drain');
  assert(dr && dr.amt === 25, 'full lifesteal on the tether');
  assertEq(sim.fighters[0].hp, 725, 'strigoi healed');
  assertEq(sim.fighters[1].hp, 1125, 'graft bled');
  assertEq(sim.fighters[0].meter, 23, 'strigoi meter: +8 hit, +15 stolen');
  assertEq(sim.fighters[1].meter, 37, 'graft meter: 50 +2 taken −15 stolen');
  assert(sim.fighters[0].drainCd > 0, 'tether on cooldown');
});

t('strigoi: drinks a pool once (heal + meter), second press finds it dry', () => {
  const sim = makeSim({ p1: 'strigoi', p2: 'graft' });
  run(sim, null, null, 70);
  sim.fighters[0].hp = 700;
  const [m0, m1] = masks(400);
  hold(m1, 0, 40, B.L);
  motion(m1, 50, 'qcf', B.FP, -1);   // staple → 60 dmg pool at strigoi's feet
  press(m0, 170, B.RF);              // drink
  press(m0, 200, B.RF);              // dry — falls through to the tether (whiffs at range)
  const evs = run(sim, m0, m1, 320);
  assert(findEv(evs, 'hit', e => e.move === 'staple_toss'), 'setup staple missing');
  assertEq(countEv(evs, 'drink'), 1, 'exactly one drink');
  assertEq(sim.fighters[0].facts.drinks, 1, 'drink ledger');
  assertEq(sim.fighters[0].hp, 700 - 60 + 40, 'staple damage then drink heal');
  const ticks = countEv(evs.filter(e => e.who === 0), 'poolTick');
  assertEq(sim.fighters[0].meter, 4 + 20 + ticks * 3, 'meter: +4 taken, +20 drink, +3/pool tick');
});

t('strigoi: Cask Slam heals half its damage', () => {
  const sim = makeSim({ p1: 'strigoi', p2: 'graft' });
  run(sim, null, null, 70);
  sim.fighters[0].hp = 600;
  const [m0, m1] = masks(300);
  hold(m0, 0, 145, B.R);
  motion(m0, 154, 'hcb', B.TH, 1);
  const evs = run(sim, m0, m1, 300);
  const gh = findEv(evs, 'grabHit');
  assert(gh, 'cask slam never landed');
  assertEq(gh.dmg, 135, 'cask damage');
  assertEq(sim.fighters[1].hp, 1015, 'graft hp');
  assertEq(sim.fighters[0].hp, 667, 'strigoi healed 67');
});

t('strigoi: CPU mirror stays deterministic (drain in the loop)', () => {
  const hashesOf = () => {
    const sim = makeSim({ p1: 'strigoi', p2: 'zenith', seed: 909, cpu: [{ level: 2 }, { level: 2 }] });
    const out = [];
    for (let f = 0; f < 3600; f++) {
      sim.step(0, 0);
      if (f % 90 === 0) out.push(sim.hash());
    }
    return out.join(',');
  };
  assertEq(hashesOf(), hashesOf(), 'strigoi CPU replay divergence');
});

// ---------------------------------------------------------------- 4d. P4 v1 — persistence

function hydratedSim(mods0, sig0, opts = {}) {
  const chars0 = hydrateBundle(
    data('data/characters/zenith/character.json'), data('data/characters/zenith/moves.json'),
    data('data/characters/zenith/sunders.json'), data('data/characters/zenith/finishers.json'), mods0);
  const chars1 = hydrateBundle(
    data('data/characters/graft/character.json'), data('data/characters/graft/moves.json'),
    data('data/characters/graft/sunders.json'), data('data/characters/graft/finishers.json'), null);
  return new Sim({
    chars: [chars0, chars1],
    arena: data('data/arenas/riftscar.json'),
    balance: data('data/balance/core.json'),
    seed: opts.seed || 42,
    sig: [sig0 || null, null],
    cpu: opts.cpu || null
  });
}

t('p4: carried Solar Debt burns max HP (capped −15%, proportional below)', () => {
  const p = freshProfile();
  charProf(p, 'zenith').sig.debt = 40;
  const mods = buildMods(p, 'zenith', false);
  assertEq(mods.hpBurnPermille, 150, 'burn caps at 15% (min(40,15)*10)');
  const sim = hydratedSim(mods, mods.sig);
  assertEq(sim.fighters[0].hpMax, 850, 'hpMax burned');
  assertEq(sim.fighters[0].hp, 850, 'starts at burned max');
  assertEq(sim.fighters[0].debt, 40, 'debt carried into the match');
  // and a light debt burns proportionally
  const p2 = freshProfile();
  charProf(p2, 'zenith').sig.debt = 8;
  const m2 = buildMods(p2, 'zenith', false);
  assertEq(m2.hpBurnPermille, 80, '8 debt → −8%');
  assertEq(hydratedSim(m2, m2.sig).fighters[0].hpMax, 920, 'hpMax 920');
});

t('p4: S-curve mastery ranks + rank-B Sunlance chips 18 through block', () => {
  assertEq(masteryRank({ uses: 0, hits: 0 }), 'D', 'fresh rank');
  assertEq(masteryRank({ uses: 20, hits: 20 }), 'B', 'B at score 80');
  assertEq(masteryRank({ uses: 20, hits: 60 }), 'A', 'A at score 200');
  assertEq(masteryRank({ uses: 100, hits: 100 }), 'S', 'S at 400');
  const p = freshProfile();
  charProf(p, 'zenith').mastery.sunlance = { uses: 20, hits: 20 }; // rank B
  const mods = buildMods(p, 'zenith', false);
  assert(mods.movePatches.sunlance, 'sunlance patch present');
  const sim = hydratedSim(mods, mods.sig);
  assertEq(sim.fighters[0].char.movesById.sunlance.chip, 18, 'rank-B chip patch applied');
  const [m0, m1] = masks(300);
  hold(m1, 0, 299, B.BL);
  motion(m0, 70, 'qcf', B.FP, 1);
  const evs = run(sim, m0, m1, 300);
  const blk = findEv(evs, 'block');
  assert(blk, 'sunlance not blocked');
  assertEq(blk.chip, 18, 'mastered chip through block');
  assertEq(sim.fighters[1].hp, 1150 - 18, 'graft hp');
});

t('p4: Tempered strips everything', () => {
  const p = freshProfile();
  charProf(p, 'zenith').sig.debt = 60;
  charProf(p, 'zenith').mastery.sunlance = { uses: 50, hits: 90 };
  assertEq(buildMods(p, 'zenith', true), null, 'tempered → no mods');
  const sim = hydratedSim(null, null);
  assertEq(sim.fighters[0].hpMax, 1000, 'normalized hp');
  assertEq(sim.fighters[0].debt, 0, 'no carried debt');
  assertEq(sim.fighters[0].char.movesById.sunlance.chip, 14, 'stock chip');
});

t('p4: match → delta → profile round-trip (XP, mastery, execution)', () => {
  const sim = makeSim();
  const [m0, m1] = masks(400);
  hold(m0, INTRO, 205, B.R);
  press(m0, 214, B.FP);
  run(sim, m0, m1, 260);
  sim.roundWins[0] = 1;
  sim.fighters[1].hp = 5;
  const [m2] = masks(400);
  press(m2, 10, B.FP);
  run(sim, m2, null, 240, s => s.phase === 'finish');
  run(sim, [0, 0, 0, B.RF], null, 4);
  run(sim, null, null, 200);
  assert(sim.matchOver && sim.executed, 'setup: executed win');
  const d = matchDelta(sim, 0);
  assertEq(d.won, true, 'won');
  assertEq(d.executed, true, 'executed');
  assert(d.uses.s_fp >= 2, 'jab uses counted');
  assert(d.hits.s_fp >= 2, 'jab hits counted');
  assertEq(d.xp, 105 + Math.trunc(sim.fighters[0].stat.dmgDealt / 40), 'xp formula');
  assertEq(d.sigCarry.debt, 0, 'no debt accrued');
  const p = freshProfile();
  applyDelta(p, 'zenith', d);
  const cp = charProf(p, 'zenith');
  assertEq(cp.wins, 1, 'win recorded');
  assertEq(cp.executions, 1, 'execution recorded');
  assertEq(cp.xp, d.xp, 'xp banked');
  assert(cp.mastery.s_fp.uses >= 2, 'mastery persisted');
});

t('p4: STRIGOI executions bank vintages by faction', () => {
  const sim = makeSim({ p1: 'strigoi', p2: 'zenith' });
  const [m0, m1] = masks(400);
  hold(m0, INTRO, 205, B.R);
  press(m0, 214, B.FP);
  run(sim, m0, m1, 260);
  sim.roundWins[0] = 1;
  sim.fighters[1].hp = 5;
  const [m2] = masks(400);
  press(m2, 10, B.FP);
  run(sim, m2, null, 240, s => s.phase === 'finish');
  run(sim, [0, 0, 0, B.RF], null, 4);
  run(sim, null, null, 200);
  assert(sim.matchOver && sim.executed, 'setup: executed win');
  const d = matchDelta(sim, 0);
  assertEq(d.sigCarry.vintage, 'vanguard', 'hero blood, banked');
  const p = freshProfile();
  applyDelta(p, 'strigoi', d);
  assertEq(charProf(p, 'strigoi').sig.bank.vanguard, 1, 'the cellar grows');
});

t('p4: hydrated matches stay deterministic', () => {
  const play = () => {
    const p = freshProfile();
    charProf(p, 'zenith').sig.debt = 25;
    charProf(p, 'zenith').mastery.sunlance = { uses: 20, hits: 20 };
    const mods = buildMods(p, 'zenith', false);
    const sim = hydratedSim(mods, mods.sig, { seed: 3131, cpu: [{ level: 2 }, { level: 2 }] });
    const out = [];
    for (let f = 0; f < 2400; f++) {
      sim.step(0, 0);
      if (f % 80 === 0) out.push(sim.hash());
    }
    return out.join(',');
  };
  assertEq(play(), play(), 'mods must not desync replays');
});

// ---------------------------------------------------------------- 5. determinism

t('determinism: CPU vs CPU, 3600 frames, bit-identical hashes', () => {
  const hashesOf = seed => {
    const sim = makeSim({ seed, cpu: [{ level: 2 }, { level: 2 }] });
    const out = [];
    for (let f = 0; f < 3600; f++) {
      sim.step(0, 0);
      if (f % 60 === 0) out.push(sim.hash());
    }
    return out;
  };
  const a = hashesOf(777);
  const b = hashesOf(777);
  assertEq(a.join(','), b.join(','), 'same seed must replay bit-identical');
  const c = hashesOf(778);
  assert(a.join(',') !== c.join(','), 'different seed should diverge');
});

t('determinism: scripted human inputs replay bit-identical', () => {
  const play = () => {
    const sim = makeSim();
    const [m0, m1] = masks(500);
    hold(m0, INTRO, 205, B.R);
    press(m0, 214, B.FP);
    press(m0, 226, B.FP);
    press(m0, 240, B.BP);
    hold(m1, 250, 290, B.BL);
    motion(m1, 300, 'hcb', B.TH, -1);
    motion(m0, 330, 'qcf', B.FP, 1);
    const out = [];
    for (let f = 0; f < 500; f++) {
      sim.step(m0[f] || 0, m1[f] || 0);
      if (f % 20 === 0) out.push(sim.hash());
    }
    return out;
  };
  assertEq(play().join(','), play().join(','), 'replay divergence');
});

t('determinism: full CPU match concludes and stays deterministic past match end', () => {
  const go = () => {
    const sim = makeSim({ seed: 4242, cpu: [{ level: 3 }, { level: 3 }] });
    for (let f = 0; f < 14000 && !sim.matchOver; f++) sim.step(0, 0);
    return sim;
  };
  const s1 = go(), s2 = go();
  assertEq(s1.hash(), s2.hash(), 'end-state hash mismatch');
  assertEq(s1.matchOver, true, 'CPU match should conclude within time');
});

// ---------------------------------------------------------------- report

let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log(`  ok    ${r.name}`); }
  else { fail++; console.log(`  FAIL  ${r.name}\n        ${r.err}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
