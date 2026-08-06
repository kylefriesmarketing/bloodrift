// The CPU seat — a reactive fighting-game opponent, not a dice roller.
//
// Runs INSIDE Sim.step off its own seeded LCG (DECISIONS D-010), so CPU matches
// replay and hash-verify exactly like human ones. It plays the controller: every
// special is performed as a real motion through the same input parser a human uses,
// so the AI can never do anything a player couldn't.
//
// Decisions run down a priority ladder — react to the biggest threat/opening first —
// and each reactive branch is gated behind a per-level reaction lag so the AI feels
// like an opponent rather than a frame-perfect wall.

import { B } from './input.mjs';
import { makeRng } from './rng.mjs';

// level 1 TIMID · 2 HUNGRY · 3 RIFT-FED
const SKILL = {
  1: { react: 20, block: 240, punish: 110, antiAir: 90, throwOnBlock: 90, meter: 150, aggro: 300, hesitate: 230 },
  2: { react: 11, block: 620, punish: 480, antiAir: 420, throwOnBlock: 300, meter: 480, aggro: 540, hesitate: 55 },
  3: { react: 6, block: 900, punish: 820, antiAir: 760, throwOnBlock: 520, meter: 820, aggro: 740, hesitate: 0 }
};

export function makeCpuState(seed, level) {
  return {
    rng: makeRng(seed >>> 0),
    mode: 'approach',
    t: 0,
    queue: [],
    level: level || 1,
    lag: 0,          // reaction delay ticking down after the opponent changes state
    oppState: '',
    blockedMe: 0,    // how often they've blocked my stuff → start throwing
    cooldown: 0      // frames before the next committed decision
  };
}

function fwdBit(facing) { return facing > 0 ? B.R : B.L; }
function backBit(facing) { return facing > 0 ? B.L : B.R; }

function dirMask(d, facing) {
  switch (d) {
    case 2: return B.D;
    case 3: return B.D | fwdBit(facing);
    case 1: return B.D | backBit(facing);
    case 6: return fwdBit(facing);
    case 4: return backBit(facing);
    default: return 0;
  }
}

const MOTION_DIRS = { qcf: [2, 3, 6], qcb: [2, 1, 4], dp: [6, 2, 3], hcb: [6, 3, 2, 4], bf: [4, 5, 6] };

function pushMotion(q, motion, btnBit, facing) {
  const dirs = MOTION_DIRS[motion];
  if (!dirs) return false;
  for (let i = 0; i < dirs.length; i++) {
    const m = dirMask(dirs[i], facing);
    q.push(m, m);
  }
  q.push(dirMask(dirs[dirs.length - 1], facing) | btnBit);
  return true;
}

function doSpecial(ai, f, mv, facing, mods = 0) {
  if (!mv || !mv.trigger) return false;
  if (mv.trigger.type === 'motion') {
    const q = [];
    if (!pushMotion(q, mv.trigger.motion, B[mv.trigger.button] | mods, facing)) return false;
    ai.queue.push(...q);
    return true;
  }
  if (mv.trigger.type === 'rift_press') { ai.queue.push(B.RF); return true; }
  if (mv.trigger.type === 'button') { ai.queue.push(B[mv.trigger.button] | mods); return true; }
  return false;
}

// how far a move's hitboxes actually reach (px from origin)
function reachOf(mv) {
  if (!mv) return 0;
  if (mv.projectile) return 620;
  if (mv.grab) return mv.grab.range + 40;
  let r = 0;
  for (const hb of mv.hitboxes || []) r = Math.max(r, hb.x + hb.w);
  return r;
}

function phaseOf(f) {
  if (f.state !== 'move' || !f.moveId) return null;
  const mv = f.char.movesById[f.moveId];
  if (!mv || !mv.frames) return null;
  const { startup, active, recovery } = mv.frames;
  if (f.moveF <= startup) return { mv, phase: 'startup', left: startup - f.moveF };
  if (f.moveF <= startup + active) return { mv, phase: 'active', left: startup + active - f.moveF };
  return { mv, phase: 'recovery', left: startup + active + recovery - f.moveF };
}

// pick from a character's own movelist — works for every fighter, no hardcoding
function findMoves(f) {
  const m = f.char.moves;
  const specials = m.filter(x => x.kind === 'special' && x.trigger.type === 'motion');
  return {
    antiAir: specials.find(x => (x.tags || []).includes('antiair'))
      || m.find(x => x.trigger.type === 'button' && x.trigger.pos === 'crouch' && x.trigger.button === 'BP'),
    fireball: specials.find(x => x.projectile && !(x.tags || []).includes('low')),
    advance: specials.find(x => (x.tags || []).includes('advance') || (x.movement || []).length),
    grab: specials.find(x => x.grab),
    launcher: m.find(x => x.knock && x.knock.type === 'launch' && x.trigger.type === 'button'),
    low: m.find(x => x.guard === 'low' && x.trigger.type === 'button' && x.trigger.pos === 'crouch'),
    poke: m.find(x => x.id === 's_fk') || m.find(x => x.id === 's_bp'),
    jab: m.find(x => x.id === 's_fp'),
    heavy: m.find(x => x.id === 's_bk') || m.find(x => x.id === 's_bp'),
    overdrive: m.find(x => x.kind === 'overdrive')
  };
}

export function cpuThink(sim, i) {
  const f = sim.fighters[i];
  const o = sim.fighters[1 - i];
  const ai = f.ai;
  const rng = ai.rng;
  const S = SKILL[ai.level] || SKILL[2];

  ai.t++;
  if (ai.cooldown > 0) ai.cooldown--;

  // Reaction lag — keyed on THREAT identity, not raw state.
  // ⚠️ Keying this on o.state made the AI blind: idle↔walk flickers every few frames,
  // so the timer reset constantly and the reactive branches never fired (measured:
  // L2 lost to L1). The token only changes on a genuinely new threat.
  const threatToken = o.state === 'move' ? 'm' + o.moveId
    : (o.y > 0 || o.state === 'air' || o.state === 'launched') ? 'air'
      : o.state === 'kd' ? 'kd' : 'n';
  if (threatToken !== ai.oppState) { ai.oppState = threatToken; ai.lag = S.react; }
  else if (ai.lag > 0) ai.lag--;
  const reacted = ai.lag <= 0;

  // a queued sequence (motion inputs, block holds, approach walks) plays out first
  if (ai.queue.length) return ai.queue.shift();

  // locked out
  if (['kd', 'grabbed', 'thrown', 'grabbing', 'ko', 'prejump'].includes(f.state)) return 0;

  // caught: mash for grabs, Transfusion out if the combo is going long.
  // ⚠️ comboHits lives on the VICTIM — that's f, not o. Reading o's counter meant
  // the AI never once broke a combo (measured 0.0 breakers/match).
  if (f.state === 'hitstun' || f.state === 'launched') {
    if (f.meter >= sim.balance.meter.breakerCost && f.comboHits >= 2 && rng.chance(S.punish)) {
      return B.BL | B.TH;
    }
    return rng.chance(400) ? B.FP : 0;
  }
  if (f.state === 'blockstun') {
    // keep holding guard through the string
    return B.BL | (rng.chance(500) ? B.D : 0);
  }
  if (f.state === 'move' || f.state === 'stance') return 0;

  // hesitation — the lower tiers second-guess themselves and give the player turns.
  // This is what makes TIMID feel like a sparring partner instead of a slightly worse wall.
  if (S.hesitate && rng.chance(S.hesitate)) {
    const n = 12 + rng.int(20);
    for (let k = 0; k < n; k++) ai.queue.push(0);
    return ai.queue.shift();
  }

  const gap = Math.trunc(Math.abs(f.x - o.x) / 1000) - Math.trunc((f.stats.width + o.stats.width) / 2);
  const fw = fwdBit(f.facing);
  const bk = backBit(f.facing);
  const mv = findMoves(f);
  const oppAir = o.y > 0 || o.state === 'air' || o.state === 'launched';
  const oppPhase = phaseOf(o);
  const myMeter = f.meter;

  // ---------------------------------------------------------------- 1. ANTI-AIR
  // they jumped: uppercut them out of the sky
  if (oppAir && reacted && gap < 190 && o.vy > -6000 && rng.chance(S.antiAir)) {
    ai.cooldown = 14;
    if (mv.antiAir && doSpecial(ai, f, mv.antiAir, f.facing, myMeter >= 100 && rng.chance(S.meter) ? B.BL : 0)) {
      return ai.queue.shift();
    }
    return B.D | B.BP;
  }

  // ---------------------------------------------------------------- 2. PUNISH
  // they whiffed or got blocked and are in recovery — take the turn
  if (oppPhase && oppPhase.phase === 'recovery' && reacted && oppPhase.left > 6 && rng.chance(S.punish)) {
    ai.cooldown = 10;
    if (gap < 60) {
      // in range: biggest thing that will connect
      if (mv.grab && rng.chance(260) && doSpecial(ai, f, mv.grab, f.facing)) return ai.queue.shift();
      if (mv.launcher && rng.chance(420)) { ai.queue.push(B.D | B[mv.launcher.trigger.button]); return ai.queue.shift(); }
      if (mv.heavy) { ai.queue.push(B[mv.heavy.trigger.button]); return ai.queue.shift(); }
      return B.BP;
    }
    if (gap < 200 && mv.advance && rng.chance(600) && doSpecial(ai, f, mv.advance, f.facing)) {
      return ai.queue.shift();
    }
    if (gap < 240) { // close the distance fast
      ai.queue.push(fw, 0, 0, fw, fw, fw, fw, fw);
      return ai.queue.shift();
    }
    if (mv.fireball && doSpecial(ai, f, mv.fireball, f.facing)) return ai.queue.shift();
  }

  // ---------------------------------------------------------------- 3. BLOCK
  // an attack is coming and it can reach me
  if (oppPhase && (oppPhase.phase === 'startup' || oppPhase.phase === 'active') && reacted) {
    const threat = reachOf(oppPhase.mv);
    if (gap < threat + 30 && rng.chance(S.block)) {
      const isLow = oppPhase.mv.guard === 'low';
      // just long enough to eat the string — not so long that guarding becomes passivity
      const hold = 5 + Math.min(oppPhase.left, 14) + rng.int(6);
      for (let k = 0; k < hold; k++) ai.queue.push(B.BL | (isLow || rng.chance(300) ? B.D : 0));
      ai.cooldown = 6;
      return ai.queue.shift();
    }
  }
  // incoming projectile: guard or jump it
  for (const p of sim.projectiles) {
    if (p.owner === i) continue;
    const dx = (p.x - f.x) * Math.sign(f.x - o.x);
    if (dx < 0 && dx > -420000 && reacted && rng.chance(S.block)) {
      for (let k = 0; k < 16 + rng.int(10); k++) ai.queue.push(B.BL);
      return ai.queue.shift();
    }
  }

  // ---------------------------------------------------------------- 4. OKI
  // they're on the floor: walk in and meet them getting up
  if (o.state === 'kd' && gap > 40) {
    ai.queue.push(fw, fw, fw, fw, fw, fw);
    return ai.queue.shift();
  }
  if (o.state === 'kd' && gap <= 40 && rng.chance(S.aggro)) {
    // meaty: a low or a throw as they stand
    if (rng.chance(400) && mv.low) { ai.queue.push(B.D | B[mv.low.trigger.button], B.D); return ai.queue.shift(); }
    ai.queue.push(0, 0, B.TH);
    return ai.queue.shift();
  }

  // ---------------------------------------------------------------- 5. OVERDRIVE
  if (myMeter >= sim.balance.meter.overdriveCost && mv.overdrive && gap < 220 &&
    (o.state === 'blockstun' || o.state === 'hitstun' || rng.chance(S.meter * 0.25))) {
    ai.queue.push(B.TH | B.RF, B.TH | B.RF, B.TH | B.RF);
    return ai.queue.shift();
  }

  // ---------------------------------------------------------------- 6. CLOSE RANGE
  if (gap < 58) {
    // they keep blocking → open them with a throw
    if (o.state === 'blockstun') ai.blockedMe = Math.min(6, ai.blockedMe + 1);
    if (ai.blockedMe >= 2 && rng.chance(S.throwOnBlock)) {
      ai.blockedMe = 0;
      if (mv.grab && rng.chance(500) && doSpecial(ai, f, mv.grab, f.facing)) return ai.queue.shift();
      return B.TH;
    }
    const roll = rng.int(100);
    if (roll < 34) { // pressure string with real gaps
      const s = [['FP', 'FP', 'BP'], ['BP', 'BK'], ['FK', 'FK'], ['FP', 'BP', 'BK']][rng.int(4)];
      for (const b of s) {
        ai.queue.push(B[b]);
        for (let g = 0; g < 9; g++) ai.queue.push(0);
      }
      return ai.queue.shift();
    }
    if (roll < 50 && mv.low) { // low mix
      ai.queue.push(B.D | B[mv.low.trigger.button], B.D, B.D);
      return ai.queue.shift();
    }
    if (roll < 64) { // special
      const specials = f.char.moves.filter(x => x.kind === 'special' && x.trigger.type === 'motion' && !x.parry &&
        (!x.requiresSet || x.requiresSet === f.gset));
      if (specials.length) {
        const pick = specials[rng.int(specials.length)];
        const ex = myMeter >= 100 && rng.chance(S.meter) ? B.BL : 0;
        if (doSpecial(ai, f, pick, f.facing, ex)) return ai.queue.shift();
      }
    }
    if (roll < 76) return B.TH;
    // reset spacing rather than mashing into a block
    for (let k = 0; k < 8 + rng.int(8); k++) ai.queue.push(bk);
    return ai.queue.shift();
  }

  // ---------------------------------------------------------------- 7. FOOTSIES
  if (gap < 230) {
    const roll = rng.int(100);
    if (roll < 20) { // whiff-bait: step back, then punish what they throw
      for (let k = 0; k < 10 + rng.int(8); k++) ai.queue.push(bk);
      return ai.queue.shift();
    }
    if (roll < 40) { ai.queue.push(fw, 0, 0, fw, fw, fw, fw); return ai.queue.shift(); } // dash in
    if (roll < 56 && mv.advance && doSpecial(ai, f, mv.advance, f.facing)) return ai.queue.shift();
    if (roll < 68 && mv.poke) { // long poke into empty space (footsie check)
      ai.queue.push(B[mv.poke.trigger.button]);
      for (let g = 0; g < 6; g++) ai.queue.push(0);
      return ai.queue.shift();
    }
    if (roll < 78 && ai.level >= 2) { // jump-in
      ai.queue.push(B.U | fw, B.U | fw, B.U | fw);
      for (let g = 0; g < 11; g++) ai.queue.push(fw);
      ai.queue.push(B.BK);
      return ai.queue.shift();
    }
    if (roll < 88 && mv.fireball && doSpecial(ai, f, mv.fireball, f.facing)) return ai.queue.shift();
    const n = 8 + rng.int(12);
    for (let k = 0; k < n; k++) ai.queue.push(fw);
    return ai.queue.shift();
  }

  // ---------------------------------------------------------------- 8. FULL SCREEN
  const roll = rng.int(100);
  if (roll < 28 && mv.fireball && doSpecial(ai, f, mv.fireball, f.facing)) return ai.queue.shift();
  if (roll < 40) { ai.queue.push(fw, 0, 0, fw, fw, fw, fw, fw); return ai.queue.shift(); }
  const n = 12 + rng.int(20);
  for (let k = 0; k < n; k++) ai.queue.push(fw);
  return ai.queue.shift();
}
