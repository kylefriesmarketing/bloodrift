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

const results = [];
function t(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message || String(e) }); }
}

const INTRO = 62; // fight phase begins ~frame 60; scripts act after this

// ---------------------------------------------------------------- 1. schemas

t('schema: character.json (both)', () => {
  const sch = data('data/schema/character.schema.json');
  for (const c of ['zenith', 'graft']) {
    const errs = validate(sch, data(`data/characters/${c}/character.json`));
    assert(errs.length === 0, `${c}: ${errs.join(' | ')}`);
  }
});

t('schema: moves.json (both)', () => {
  const sch = data('data/schema/moves.schema.json');
  for (const c of ['zenith', 'graft']) {
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
  for (const c of ['zenith', 'graft']) {
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
