// BLOODRIFT P4 v1 — the persistent layer (BUILD_PLAN §6 P4, GDD §7).
// Pure functions over a plain profile object; the HOST owns storage (browser:
// localStorage, tests: in-memory). Persistence enters the match ONLY as data:
// a rebuilt character bundle + a sig-init object — the sim stays deterministic.
//
// Riftborn rules = hydrate everything. Tempered = pass nothing (GDD §7.3).

import { makeCharBundle } from '../sim/sim.mjs';

export const PROFILE_KEY = 'br-profile-v1';

export function freshProfile() {
  return { v: 1, chars: {} };
}

export function charProf(profile, id) {
  if (!profile.chars[id]) {
    profile.chars[id] = {
      xp: 0, matches: 0, wins: 0, executions: 0, spares: 0,
      mastery: {},          // moveId -> {uses, hits}
      sig: {}               // signature persistent state (debt / joules / bank...)
    };
  }
  return profile.chars[id];
}

export function levelOf(xp) {
  return Math.min(30, 1 + Math.floor(xp / 150));
}

// mastery score → rank. Rank effects come from each move's own `mastery.ranks` data.
export function masteryScore(m) { return (m.uses || 0) + 3 * (m.hits || 0); }
export function masteryRank(m) {
  const s = masteryScore(m);
  if (s >= 400) return 'S';
  if (s >= 180) return 'A';
  if (s >= 80) return 'B';
  if (s >= 30) return 'C';
  return 'D';
}
const RANK_AT = { D: 0, C: 1, B: 2, A: 3, S: 4 };

// ---- hydration: profile → per-match mods (plain data)

export function buildMods(profile, charId, tempered) {
  if (tempered) return null;
  const cp = charProf(profile, charId);
  const mods = { movePatches: {}, sig: {}, hpBurnPermille: 0 };
  // signature persistence by hook id
  if (charId === 'zenith') {
    const debt = Math.max(0, Math.min(100, cp.sig.debt || 0));
    mods.sig.debt = debt;
    // "Carried debt burns his max HP next match (up to −15%)" — formula from character.json
    mods.hpBurnPermille = Math.min(debt, 15) * 10;
  }
  if (charId === 'joule') {
    mods.sig.joules = Math.max(0, Math.min(300, cp.sig.joules || 0));
  }
  // mastery rank effects (rank B+: field patches; A+: ex_adds)
  for (const [moveId, m] of Object.entries(cp.mastery)) {
    const rank = RANK_AT[masteryRank(m)];
    if (rank >= 2) mods.movePatches[moveId] = { _rank: masteryRank(m) };
  }
  return mods;
}

// ---- apply mods to a character's RAW data → a fresh bundle (sim untouched)

export function hydrateBundle(rawChar, rawMoves, rawSunders, rawFinishers, mods) {
  if (!mods) return makeCharBundle(rawChar, rawMoves, rawSunders, rawFinishers);
  let char = rawChar;
  if (mods.hpBurnPermille > 0) {
    char = { ...rawChar, stats: { ...rawChar.stats, hp: Math.trunc(rawChar.stats.hp * (1000 - mods.hpBurnPermille) / 1000) } };
  }
  const moves = rawMoves.map(mv => {
    const p = mods.movePatches[mv.id];
    if (!p || !mv.mastery || !mv.mastery.ranks) return mv;
    let out = { ...mv };
    const rank = RANK_AT[p._rank];
    // cumulative: B effects at B+, A effects at A+
    if (rank >= 2 && mv.mastery.ranks.B) {
      for (const [k, v] of Object.entries(mv.mastery.ranks.B)) {
        if (k !== 'unlocks' && k !== 'ex_adds') out[k] = v;
      }
    }
    if (rank >= 3 && mv.mastery.ranks.A && mv.mastery.ranks.A.ex_adds && out.variants && out.variants.ex) {
      out = {
        ...out,
        variants: {
          ...out.variants,
          ex: { ...out.variants.ex, adds: [...(out.variants.ex.adds || []), ...mv.mastery.ranks.A.ex_adds] }
        }
      };
    }
    return out;
  });
  return makeCharBundle(char, moves, rawSunders, rawFinishers);
}

// ---- write-back: end-of-match → profile delta (pure)

export function matchDelta(sim, seat) {
  const f = sim.fighters[seat];
  const won = sim.winner === seat;
  const executed = !!sim.executed && won;
  const spared = sim.matchOver && won && !sim.executed;
  const uses = { ...(f.facts.muses || {}) };
  const hits = { ...(f.facts.mhits || {}) };
  let xp = 40 + (won ? 40 : 0) + (executed ? 25 : 0) + (spared ? 15 : 0);
  xp += Math.min(30, Math.trunc(f.stat.dmgDealt / 40));
  const sigCarry = {};
  if (f.char.character.id === 'zenith') sigCarry.debt = f.debt;
  if (f.char.character.id === 'joule') sigCarry.joules = f.joules || 0;
  if (f.char.character.id === 'strigoi') {
    sigCarry.drinksTotal = (f.facts.drinks || 0);
    if (executed) sigCarry.vintage = sim.fighters[1 - seat].char.character.faction;
  }
  return { xp, won, executed, spared, uses, hits, sigCarry };
}

export function applyDelta(profile, charId, delta) {
  const cp = charProf(profile, charId);
  cp.matches++;
  if (delta.won) cp.wins++;
  if (delta.executed) cp.executions++;
  if (delta.spared) cp.spares++;
  cp.xp += delta.xp;
  for (const [id, n] of Object.entries(delta.uses)) {
    const m = cp.mastery[id] = cp.mastery[id] || { uses: 0, hits: 0 };
    m.uses += n;
  }
  for (const [id, n] of Object.entries(delta.hits)) {
    const m = cp.mastery[id] = cp.mastery[id] || { uses: 0, hits: 0 };
    m.hits += n;
  }
  // signature carry
  if (delta.sigCarry.debt !== undefined) cp.sig.debt = delta.sigCarry.debt;
  if (delta.sigCarry.joules !== undefined) cp.sig.joules = delta.sigCarry.joules;
  if (delta.sigCarry.vintage) {
    cp.sig.bank = cp.sig.bank || { vanguard: 0, court: 0, dominion: 0 };
    cp.sig.bank[delta.sigCarry.vintage]++;
  }
  return profile;
}
