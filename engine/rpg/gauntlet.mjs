// THE GAUNTLET (P6, D-017) — pure seeded run logic. No DOM, no storage:
// the host launches fights from `fightSetup` and reports results back.
// Same seed → the same tower, opponent for opponent, mutator for mutator.

import { makeRng } from '../sim/rng.mjs';

export const FLOORS = 7;
const CPU_RAMP = [1, 1, 2, 2, 2, 3, 3];

// everyone climbs the same tower each week
export function weeklySeed(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return ((d.getUTCFullYear() * 100 + week) * 2654435761 >>> 0) | 1;
}

export function makeRun(seed, playerChar, roster, mutatorList) {
  const rng = makeRng(seed >>> 0);
  const opps = roster.filter(c => c !== playerChar);
  // unique mutator order for floors 2..7 (seeded shuffle)
  const mIdx = mutatorList.map((_, i) => i);
  for (let i = mIdx.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [mIdx[i], mIdx[j]] = [mIdx[j], mIdx[i]];
  }
  const floors = [];
  let last = null;
  for (let f = 1; f <= FLOORS; f++) {
    let opp = opps[rng.int(opps.length)];
    if (opp === last && opps.length > 1) opp = opps[(opps.indexOf(opp) + 1) % opps.length];
    last = opp;
    floors.push({
      floor: f,
      opp,
      cpuLevel: CPU_RAMP[f - 1],
      mutatorId: f >= 2 ? mutatorList[mIdx[(f - 2) % mIdx.length]].id : null
    });
  }
  return { seed: seed >>> 0, player: playerChar, floors };
}

export function makeRunState() {
  return { floor: 1, boons: [], done: false, cleared: false, bestFloor: 0 };
}

// 3 distinct boons offered after a won floor; stackables can repeat, one-shots can't
const STACKABLE = new Set(['sharpened', 'leech_stitch', 'iron_skin']);
export function boonOffer(run, state, boonList) {
  const rng = makeRng((run.seed ^ (state.floor * 2654435761)) >>> 0);
  const owned = state.boons;
  const pool = boonList.filter(b => STACKABLE.has(b.id) || !owned.includes(b.id));
  const out = [];
  let guard = 0;
  while (out.length < Math.min(3, pool.length) && guard++ < 40) {
    const pick = pool[rng.int(pool.length)];
    if (!out.includes(pick)) out.push(pick);
  }
  return out;
}

// collapse the run's boons into per-seat sim mods + an hp multiplier
export function boonsToMods(boonIds, boonList) {
  const byId = Object.fromEntries(boonList.map(b => [b.id, b]));
  const mods = { dmgPermille: 1000, lifestealAdd: 0, chipImmune: false, breakerCost: 0, startMeter: 0 };
  let hpPermille = 1000;
  for (const id of boonIds) {
    const b = byId[id];
    if (!b) continue;
    if (b.hpPermille) hpPermille = Math.trunc(hpPermille * b.hpPermille / 1000);
    const sm = b.seatMods || {};
    if (sm.dmgPermille) mods.dmgPermille = Math.trunc(mods.dmgPermille * sm.dmgPermille / 1000);
    if (sm.lifestealAdd) mods.lifestealAdd += sm.lifestealAdd;
    if (sm.chipImmune) mods.chipImmune = true;
    if (sm.breakerCost) mods.breakerCost = mods.breakerCost ? Math.min(mods.breakerCost, sm.breakerCost) : sm.breakerCost;
    if (sm.startMeter) mods.startMeter = Math.min(300, mods.startMeter + sm.startMeter);
  }
  return { seatMods: mods, hpPermille };
}

// everything the host needs to build this floor's Sim
export function fightSetup(run, state, mutatorList) {
  const fl = run.floors[state.floor - 1];
  const byId = Object.fromEntries(mutatorList.map(m => [m.id, m]));
  const active = run.floors
    .slice(0, state.floor)
    .map(x => x.mutatorId)
    .filter(Boolean)
    .map(id => byId[id])
    .filter(Boolean);
  const tuning = { dmgPermille: 1000, bleedMul: 1000, meterMul: 1000, poolAcid: 0, startTrauma: 0 };
  const balancePatch = {};
  for (const m of active) {
    const t = m.tuning || {};
    if (t.dmgPermille) tuning.dmgPermille = Math.trunc(tuning.dmgPermille * t.dmgPermille / 1000);
    if (t.bleedMul) tuning.bleedMul = Math.trunc(tuning.bleedMul * t.bleedMul / 1000);
    if (t.meterMul) tuning.meterMul = Math.trunc(tuning.meterMul * t.meterMul / 1000);
    if (t.poolAcid) tuning.poolAcid = Math.max(tuning.poolAcid, t.poolAcid);
    if (t.startTrauma) tuning.startTrauma = Math.max(tuning.startTrauma, t.startTrauma);
    const b = m.balance || {};
    if (b.timerSec) balancePatch.timerSec = Math.min(balancePatch.timerSec || 999, b.timerSec);
    if (b.toWin) balancePatch.toWin = Math.min(balancePatch.toWin || 9, b.toWin);
  }
  return {
    floor: fl.floor,
    opp: fl.opp,
    cpuLevel: fl.cpuLevel,
    seed: ((run.seed ^ (fl.floor * 40503)) >>> 0) | 1,
    activeMutators: active,
    tuning,
    balancePatch
  };
}

export function advance(state, won) {
  state.bestFloor = Math.max(state.bestFloor, won ? state.floor : state.floor - 1);
  if (!won) { state.done = true; return state; }
  if (state.floor >= FLOORS) { state.done = true; state.cleared = true; return state; }
  state.floor++;
  return state;
}

// profile write-back for a finished run
export function recordRun(profile, charId, state, charProfFn) {
  const cp = charProfFn(profile, charId);
  cp.gauntlet = cp.gauntlet || { clears: 0, bestFloor: 0, runs: 0 };
  cp.gauntlet.runs++;
  cp.gauntlet.bestFloor = Math.max(cp.gauntlet.bestFloor, state.bestFloor);
  if (state.cleared) cp.gauntlet.clears++;
  cp.xp += state.cleared ? 200 : state.bestFloor * 15;
  return cp.gauntlet;
}
