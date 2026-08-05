// Deterministic CPU seat. Pure function of (sim state, own LCG stream) → input mask.
// Runs INSIDE Sim.step, so CPU matches replay/hash-verify exactly like human matches
// (DECISIONS D-010). It "plays the controller": specials are performed as real input
// sequences fed through the same motion parser humans use.

import { B } from './input.mjs';
import { makeRng } from './rng.mjs';

export function makeCpuState(seed, level) {
  return { rng: makeRng(seed >>> 0), mode: 'approach', t: 0, queue: [], level: level || 1 };
}

function fwdBit(facing) { return facing > 0 ? B.R : B.L; }
function backBit(facing) { return facing > 0 ? B.L : B.R; }

// numpad dir (relative) → absolute mask
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
    q.push(m, m); // 2 frames per direction
  }
  const last = dirMask(dirs[dirs.length - 1], facing);
  q.push(last | btnBit);
  return true;
}

export function cpuThink(sim, i) {
  const f = sim.fighters[i];
  const o = sim.fighters[1 - i];
  const ai = f.ai;
  const rng = ai.rng;

  if (ai.queue.length) return ai.queue.shift();

  // nothing to decide while locked out
  if (['kd', 'grabbed', 'thrown', 'grabbing', 'launched', 'ko'].includes(f.state)) return 0;
  if (f.state === 'hitstun' || f.state === 'blockstun') {
    // rare breaker (needs 2 pints)
    if (f.state === 'hitstun' && f.meter >= sim.balance.meter.breakerCost && rng.chance(30 + ai.level * 25)) {
      return B.BL | B.TH;
    }
    return 0;
  }
  if (f.state === 'move' || f.state === 'stance' || f.state === 'prejump') return 0;

  const gap = Math.trunc(Math.abs(f.x - o.x) / 1000) - Math.trunc((f.stats.width + o.stats.width) / 2);
  const level = ai.level;
  const fw = fwdBit(f.facing);

  // air: use the air normal
  if (f.state === 'air') {
    if (!f.airMoveUsed && gap < 150 && rng.chance(300)) {
      return rng.chance(500) ? B.BP : B.BK;
    }
    return 0;
  }

  // defend reaction: opponent attacking nearby → hold block a while
  if (o.state === 'move' && gap < 220 && rng.chance(180 + level * 90)) {
    const n = 16 + rng.int(18);
    const low = rng.chance(450);
    for (let k = 0; k < n; k++) ai.queue.push(B.BL | (low ? B.D : 0));
    return ai.queue.shift();
  }

  // overdrive when loaded and in range
  if (f.meter >= sim.balance.meter.overdriveCost && gap < 260 && rng.chance(60 + level * 40)) {
    ai.queue.push(B.TH | B.RF, B.TH | B.RF, B.TH | B.RF);
    return ai.queue.shift();
  }

  // rift-button instincts: drain sips/tethers, the surgeon charts, the bank braces
  const mech = f.char.character.rift_button.mechanic;
  if (['drain', 'atlas', 'audit', 'rift_special'].includes(mech) && f.drainCd <= 0 && gap < 260 && rng.chance(140)) {
    return B.RF;
  }
  if (mech === 'bank' && o.state === 'move' && gap < 200 && rng.chance(120)) {
    const n = 20 + rng.int(30);
    for (let k = 0; k < n; k++) ai.queue.push(B.RF); // Absolute Armor brace
    return ai.queue.shift();
  }

  if (gap < 55) {
    const roll = rng.int(100);
    if (roll < 16) { // universal throw
      return B.TH;
    }
    if (roll < 30) { // try a special (data-driven: pick one from the movelist)
      const specials = f.char.moves.filter(m => m.kind === 'special' && m.trigger.type === 'motion' && !m.parry);
      if (specials.length) {
        const mv = specials[rng.int(specials.length)];
        if (pushMotion(ai.queue, mv.trigger.motion, B[mv.trigger.button], f.facing)) return ai.queue.shift();
      }
    }
    if (roll < 62) { // string pressure: button, pause, button, pause, ender
      const openers = [['FP', 'FP', 'BP'], ['BP', 'BK'], ['FK', 'FK'], ['FP', 'BP', 'BK']];
      const s = openers[rng.int(openers.length)];
      for (let k = 0; k < s.length; k++) {
        ai.queue.push(B[s[k]]);
        for (let g = 0; g < 9; g++) ai.queue.push(0);
      }
      return ai.queue.shift();
    }
    if (roll < 75) { // low poke
      ai.queue.push(B.D | B.FK, B.D);
      return ai.queue.shift();
    }
    // step back
    for (let k = 0; k < 10; k++) ai.queue.push(backBit(f.facing));
    return ai.queue.shift();
  }

  if (gap < 220) {
    const roll = rng.int(100);
    if (roll < 18) { // dash in (double-tap forward through the real parser)
      ai.queue.push(fw, 0, 0, fw, fw, fw, fw);
      return ai.queue.shift();
    }
    if (roll < 34) { // projectile / advancing special
      const specials = f.char.moves.filter(m => m.kind === 'special' && m.trigger.type === 'motion' && !m.parry && !m.grab);
      if (specials.length) {
        const mv = specials[rng.int(specials.length)];
        if (pushMotion(ai.queue, mv.trigger.motion, B[mv.trigger.button], f.facing)) return ai.queue.shift();
      }
    }
    if (roll < 44 && level >= 1) { // jump in
      ai.queue.push(B.U | fw, B.U | fw, B.U | fw);
      for (let g = 0; g < 12; g++) ai.queue.push(fw);
      ai.queue.push(B.BK);
      return ai.queue.shift();
    }
    if (roll < 70) { // walk in
      const n = 8 + rng.int(14);
      for (let k = 0; k < n; k++) ai.queue.push(fw);
      return ai.queue.shift();
    }
    // poke
    ai.queue.push(rng.chance(500) ? B.FK : B.BP);
    for (let g = 0; g < 6; g++) ai.queue.push(0);
    return ai.queue.shift();
  }

  // far: mostly approach, sometimes fireball (if the kit has one)
  const roll = rng.int(100);
  if (roll < 22) {
    const fireballs = f.char.moves.filter(m => m.kind === 'special' && m.projectile);
    if (fireballs.length) {
      const mv = fireballs[rng.int(fireballs.length)];
      if (pushMotion(ai.queue, mv.trigger.motion, B[mv.trigger.button], f.facing)) return ai.queue.shift();
    }
  }
  if (roll < 34) { // dash
    ai.queue.push(fw, 0, 0, fw, fw, fw, fw, fw);
    return ai.queue.shift();
  }
  const n = 12 + rng.int(20);
  for (let k = 0; k < n; k++) ai.queue.push(fw);
  return ai.queue.shift();
}
