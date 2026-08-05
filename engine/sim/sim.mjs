// BLOODRIFT deterministic sim core.
// Fixed 60Hz steps, integer math only (positions/velocities in millipx), seeded LCG,
// zero DOM/render knowledge. The renderer consumes `sim.ev` (transient events) after
// each step; everything gameplay-relevant lives in serializable state.
//
// Iron rule: no ambient randomness in this directory — seeded LCG only (purity-tested).

import { B, InputTracker } from './input.mjs';
import { makeRng } from './rng.mjs';
import { cpuThink, makeCpuState } from './cpu.mjs';

export const SCALE = 1000;
const BURN_T = 90;       // ignite: 18 hp over 90 frames
const BURN_STEP = 5;     // 1 hp per 5 frames
const REGIONS = ['ARMS', 'BODY', 'LEGS', 'HEAD'];

const trunc = (a, b) => Math.trunc(a / b);

// ---------------------------------------------------------------- move resolve

function mergeVariant(base, patch) {
  const m = { ...base };
  for (const k of Object.keys(patch)) {
    if (k === 'adds') m.adds = [...(base.adds || []), ...patch.adds];
    else m[k] = patch[k];
  }
  m.frames = { ...base.frames, ...(patch.frames || {}) };
  return m;
}

export function resolveMove(char, id, variant) {
  const key = id + '|' + (variant || '');
  if (!char._mvCache) char._mvCache = new Map();
  if (char._mvCache.has(key)) return char._mvCache.get(key);
  const base = char.movesById[id];
  let m = base;
  if (variant && base.variants && base.variants[variant]) {
    m = mergeVariant(base, base.variants[variant]);
  }
  const adds = m.adds || [];
  if (adds.includes('knockdown')) m = { ...m, knock: { type: 'down', vx: 6000 } };
  if (adds.includes('invuln_startup')) m = { ...m, invuln: { frames: [1, 8], vs: 'all' } };
  char._mvCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------- fighter

class Fighter {
  constructor(id, char, x, facing) {
    this.id = id;
    this.char = char; // static data, not serialized
    const st = char.character.stats;
    this.x = x * SCALE;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.hpMax = st.hp;
    this.hp = st.hp;
    this.meter = 0;
    this.state = 'idle';
    this.stateT = 0;
    this.stateDur = 0;
    // move execution
    this.moveId = null;
    this.moveVar = null;
    this.moveF = 0;
    this.hitDone = false;
    this.contactMade = false;
    this.contactF = 0;
    this.chainBuf = null;
    this.recoveryAdd = 0;
    this.armorLeft = 0;
    this.airMoveUsed = false;
    this.counterable = false;   // whiffed/parried move → next hit is a counter
    // stun / knockdown
    this.stunT = 0;
    this.kdT = 0;
    this.kdHard = false;
    this.kdDelayed = false;
    this.invulnT = 0;           // wakeup strike-invuln
    this.throwInvulnT = 0;
    // combo (as victim)
    this.comboHits = 0;
    this.comboDmg = 0;
    // wounds
    this.trauma = { ARMS: 0, BODY: 0, LEGS: 0, HEAD: 0 };
    this.bleedRegions = [];     // regions that CROSSED into wound state 3 this round
    this.bleedAcc = 0;
    this.burnT = 0;
    this.poolTickT = 0;
    // input buffers
    this.pressAge = { FP: 99, BP: 99, FK: 99, BK: 99, TH: 99, RF: 99 };
    this.lastFwdTap = -99;
    this.lastBackTap = -99;
    this.prevDir = 5;
    // grabs
    this.grabT = 0;
    this.grabMove = null;
    this.grabVar = null;
    this.techT = 0;
    this.mashCount = 0;
    // signature mechanics
    this.debt = 0;
    this.flaresRound = 0;
    this.gset = 'power';        // graft: active graft-set
    this.graftHp = 0;
    this.rfCd = 0;
    this.stancePhase = null;    // 'enter'|'hold'|'exit'
    // sunders (P3): regions broken on THIS fighter + the facts ledger for triggers
    this.sundered = { ARMS: false, BODY: false, LEGS: false, HEAD: false };
    this.facts = { absorbs: 0, mhits: {}, drinks: 0 };
    this.concussT = 0;
    this.lowPunishable = false;
    this.drainCd = 0;
    // stats for goldens / achievements-later
    this.stat = { dmgDealt: 0, flares: 0, throwsTeched: 0, parries: 0, absorbed: 0 };
    if (char.character.rift_button.mechanic === 'graft_sets') {
      this.graftHp = char.character.rift_button.config.poolStart;
    }
    this.ai = null;             // set by sim for CPU seats
  }

  get stats() { return this.char.character.stats; }

  woundState(region) {
    const th = this.balanceRef.trauma.thresholds;
    const t = this.trauma[region];
    if (t >= th[2]) return 3;
    if (t >= th[1]) return 2;
    if (t >= th[0]) return 1;
    return 0;
  }

  grounded() { return this.y <= 0 && this.state !== 'air' && this.state !== 'launched' && this.state !== 'prejump'; }
  airborne() { return this.state === 'air' || this.state === 'launched' || this.state === 'prejump' && false || this.y > 0; }
  inStun() { return this.state === 'hitstun' || this.state === 'blockstun' || this.state === 'launched'; }
  neutralGround() {
    return ['idle', 'walkF', 'walkB', 'crouch'].includes(this.state);
  }
  canAct() {
    return ['idle', 'walkF', 'walkB', 'crouch', 'land'].includes(this.state) ||
      (this.state === 'dashF' || this.state === 'dashB') && this.stateT >= 2;
  }
  grabbable() {
    return ['idle', 'walkF', 'walkB', 'crouch', 'dashF', 'dashB', 'land', 'move', 'stance'].includes(this.state) &&
      this.throwInvulnT <= 0 && this.y <= 0;
  }

  serialize() {
    return {
      x: this.x, y: this.y, vx: this.vx, vy: this.vy, fa: this.facing,
      hp: this.hp, hm: this.hpMax, mt: this.meter,
      st: this.state, sT: this.stateT, sD: this.stateDur,
      mv: this.moveId, mV: this.moveVar, mF: this.moveF,
      hD: this.hitDone, cM: this.contactMade, cF: this.contactF, cB: this.chainBuf,
      rA: this.recoveryAdd, aL: this.armorLeft, aU: this.airMoveUsed, co: this.counterable,
      su: this.stunT, kd: this.kdT, kh: this.kdHard, kD: this.kdDelayed,
      iv: this.invulnT, ti: this.throwInvulnT,
      ch: this.comboHits, cd: this.comboDmg,
      tr: [this.trauma.ARMS, this.trauma.BODY, this.trauma.LEGS, this.trauma.HEAD],
      br: this.bleedRegions.join(','), ba: this.bleedAcc, bu: this.burnT, pt: this.poolTickT,
      gt: this.grabT, gm: this.grabMove, gv: this.grabVar, tc: this.techT, ms: this.mashCount,
      db: this.debt, fl: this.flaresRound, gs: this.gset, gh: this.graftHp,
      rc: this.rfCd, sp: this.stancePhase, sq: this.stanceT || 0,
      sn: [this.sundered.ARMS, this.sundered.BODY, this.sundered.LEGS, this.sundered.HEAD],
      fa2: { a: this.facts.absorbs, m: this.facts.mhits, d: this.facts.drinks },
      cc: this.concussT, lp: this.lowPunishable, dcd: this.drainCd,
      pa: [this.pressAge.FP, this.pressAge.BP, this.pressAge.FK, this.pressAge.BK, this.pressAge.TH, this.pressAge.RF],
      dw: this.dashWant || null, lf: this.lastFwdTap, lb: this.lastBackTap, pd: this.prevDir,
      pv: this.pushVx || 0, ps: this.pushVxSelf || 0, wr: !!this.wakeRoll,
      pj: !!this.projSpawned, ma: !!this.moveAir, pT: !!this.passThrough, lc: this.lastCause || null,
      ai: this.ai ? { r: this.ai.rng.state, m: this.ai.mode, t: this.ai.t, q: this.ai.queue.slice(0, 40) } : null
    };
  }
}

// ---------------------------------------------------------------- sim

export class Sim {
  /**
   * @param {object} opts
   *  chars: [charBundle, charBundle] — {character, movesById, moves}
   *  arena, balance, seed, cpu: [null|{level}] per seat
   */
  constructor(opts) {
    this.opts = opts;
    this.arena = opts.arena;
    this.balance = opts.balance;
    this.rng = makeRng(opts.seed || 1);
    this.frame = 0;
    this.phase = 'intro';
    this.phaseT = 60;
    this.roundNum = 1;
    this.roundWins = [0, 0];
    this.timer = this.balance.rounds.timerSec; // seconds; ticks down once per 60 frames
    this.hitstopT = 0;
    this.superFlashT = 0;
    this.winner = -1;
    this.winReason = null;
    this.roundWinner = -1;
    this.roundReason = null;
    this.matchOver = false;
    this.projectiles = [];
    this.nextProjId = 1;
    this.pools = [];
    this.ev = [];
    this.trackers = [new InputTracker(), new InputTracker()];

    const a = this.arena;
    this.fighters = [
      new Fighter(0, opts.chars[0], a.spawn.p1, 1),
      new Fighter(1, opts.chars[1], a.spawn.p2, -1)
    ];
    for (const f of this.fighters) {
      f.balanceRef = this.balance;
      // universal throw pseudo-move
      const th = f.char.character.throw;
      f.char.movesById['_throw'] = {
        id: '_throw', name: 'Throw', kind: 'special', guard: 'throw', limb_tag: 'BODY',
        trigger: { type: 'button', button: 'TH', pos: 'stand' },
        frames: { startup: th.startup, active: 2, recovery: 22, hitstop: 0 },
        damage: th.damage, chip: 0, meterGain: { hit: 10, block: 0 },
        knock: { type: 'down', vx: 6500, vy: -6500 },
        grab: { range: th.range, cinematicFrames: 28, mashReduce: 0, damageFloor: th.damage, airOk: false },
        techable: true
      };
    }
    if (opts.cpu) {
      for (let i = 0; i < 2; i++) {
        if (opts.cpu[i]) this.fighters[i].ai = makeCpuState((opts.seed || 1) ^ (0x9e37 + i * 7919), opts.cpu[i].level || 1);
      }
    }
  }

  emit(e) { this.ev.push(e); }

  other(i) { return this.fighters[1 - i]; }

  // ---------------- public step

  step(mask0, mask1) {
    this.ev = [];
    this.frame++;
    const masks = [mask0 | 0, mask1 | 0];

    // CPU seats generate their own inputs (deterministically, inside the sim)
    for (let i = 0; i < 2; i++) {
      if (this.fighters[i].ai && this.phase === 'fight') {
        masks[i] = cpuThink(this, i);
      }
    }
    for (let i = 0; i < 2; i++) {
      this.trackers[i].step(masks[i], this.fighters[i].facing);
      this.trackPresses(i);
    }

    if (this.phase !== 'fight') { this.phaseTick(); return; }

    if (this.superFlashT > 0) { this.superFlashT--; return; }
    if (this.hitstopT > 0) {
      this.hitstopT--;
      this.checkBreaker();
      return;
    }

    for (let i = 0; i < 2; i++) this.act(i);
    this.checkBreaker();
    for (let i = 0; i < 2; i++) this.integrate(i);
    this.clampAndPush();
    this.updateFacing();
    this.advanceProjectiles();

    const contacts = this.collectContacts();
    this.applyContacts(contacts);
    this.tickGrabs();
    this.tickPools();
    this.tickDots();
    this.tickTimer();
    this.checkRound();
  }

  // ---------------- input bookkeeping

  trackPresses(i) {
    const f = this.fighters[i];
    const tr = this.trackers[i];
    for (const b of ['FP', 'BP', 'FK', 'BK', 'TH', 'RF']) {
      f.pressAge[b] = tr.pressed(B[b]) ? 0 : Math.min(99, f.pressAge[b] + 1);
    }
    // dash detection: fresh tap of pure-forward / pure-back
    const d = tr.dirAt(0);
    if (d !== f.prevDir) {
      if (d === 6) {
        if (this.frame - f.lastFwdTap <= 11) f.dashWant = 'F';
        f.lastFwdTap = this.frame;
      } else if (d === 4) {
        if (this.frame - f.lastBackTap <= 11) f.dashWant = 'B';
        f.lastBackTap = this.frame;
      }
      f.prevDir = d;
    }
  }

  buffered(i, btn, maxAge) {
    const f = this.fighters[i];
    if (f.concussT > 0) maxAge = 0; // Sundered HEAD: inputs ghost after every hit taken
    return f.pressAge[btn] <= maxAge;
  }
  consume(i, btn) { this.fighters[i].pressAge[btn] = 99; }

  // ---------------- intent / state machine

  act(i) {
    const f = this.fighters[i];
    const tr = this.trackers[i];
    f.stateT++;
    if (f.rfCd > 0) f.rfCd--;
    if (f.invulnT > 0) f.invulnT--;
    if (f.throwInvulnT > 0) f.throwInvulnT--;
    if (f.concussT > 0) f.concussT--;
    if (f.drainCd > 0) f.drainCd--;
    if (f.sundered.LEGS) f.dashWant = null; // Sundered LEGS: no dashes

    switch (f.state) {
      case 'idle': case 'walkF': case 'walkB': case 'crouch': {
        if (this.tryStanceAndRift(i)) return;
        if (this.tryStartAttack(i)) return;
        // jump
        if (tr.held(B.U)) { this.setState(f, 'prejump', f.stats.prejump); f.throwInvulnT = f.stats.prejump + 2; return; }
        // dash
        if (f.dashWant === 'F') { f.dashWant = null; this.setState(f, 'dashF', f.stats.dashF.dur + (f.stats.dashF.tail || 0)); return; }
        if (f.dashWant === 'B') { f.dashWant = null; this.setState(f, 'dashB', f.stats.dashB.dur + (f.stats.dashB.tail || 0)); return; }
        // posture
        const dir = tr.dirAt(0);
        if (tr.held(B.D)) { if (f.state !== 'crouch') this.setState(f, 'crouch', 0); }
        else if (dir === 6) { if (f.state !== 'walkF') this.setState(f, 'walkF', 0); }
        else if (dir === 4) { if (f.state !== 'walkB') this.setState(f, 'walkB', 0); }
        else if (f.state !== 'idle') this.setState(f, 'idle', 0);
        return;
      }
      case 'dashF': case 'dashB': {
        const cfg = f.state === 'dashF' ? f.stats.dashF : f.stats.dashB;
        if (f.stateT >= f.stateDur) { this.setState(f, 'idle', 0); return; }
        if (f.stateT <= cfg.dur && f.stateT >= 3 && this.tryStartAttack(i)) return;
        return;
      }
      case 'prejump': {
        if (f.stateT >= f.stateDur) {
          this.setState(f, 'air', 0);
          f.vy = f.stats.jumpVy;
          const d = tr.dirAt(0);
          f.vx = d === 6 || d === 9 ? trunc(f.stats.walkF * 135, 100) * f.facing
            : d === 4 || d === 7 ? -trunc(f.stats.walkF * 120, 100) * f.facing : 0;
          f.airMoveUsed = false;
        }
        return;
      }
      case 'air': {
        if (!f.airMoveUsed && this.tryStartAirAttack(i)) return;
        return;
      }
      case 'land': {
        if (f.stateT >= f.stateDur) this.setState(f, 'idle', 0);
        return;
      }
      case 'move': {
        this.tickMove(i);
        return;
      }
      case 'stance': {
        this.tickStance(i);
        return;
      }
      case 'hitstun': case 'blockstun': {
        f.stunT--;
        if (f.stunT <= 0) { this.setState(f, 'idle', 0); this.other(i).counterable = false; this.resetCombo(f); }
        return;
      }
      case 'launched': return; // physics-driven
      case 'kd': {
        if (f.stateT >= f.stateDur) {
          // wakeup options
          if (!f.kdDelayed && tr.held(B.D)) { f.kdDelayed = true; f.stateDur += this.balance.wakeup.delayedExtra; return; }
          if (tr.held(B.BL) && f.meter >= this.balance.meter.rollCost && !f.kdHard) {
            f.meter -= this.balance.meter.rollCost;
            this.setState(f, 'wakeup', this.balance.wakeup.rollFrames);
            f.invulnT = this.balance.wakeup.rollFrames + 2;
            f.wakeRoll = true;
            this.emit({ t: 'roll', who: i });
            return;
          }
          this.setState(f, 'wakeup', 8);
          f.invulnT = 9;
          f.wakeRoll = false;
        }
        return;
      }
      case 'wakeup': {
        if (f.stateT >= f.stateDur) { this.setState(f, 'idle', 0); f.wakeRoll = false; }
        return;
      }
      default: return; // grabbing/grabbed/thrown/throwing/ko/win — timer-driven elsewhere
    }
  }

  setState(f, state, dur) {
    f.state = state;
    f.stateT = 0;
    f.stateDur = dur;
    f.lowPunishable = false; // any state change closes the punish window
    if (state !== 'move') { f.moveId = null; f.moveVar = null; f.moveF = 0; f.chainBuf = null; f.recoveryAdd = 0; }
  }

  gainMeter(f, amt) {
    if (amt <= 0) return;
    if (f.sundered.BODY) amt = trunc(amt * 7, 10); // Sundered BODY: meter gain -30%
    f.meter = Math.min(this.balance.meter.max, f.meter + amt);
  }

  resetCombo(f) { f.comboHits = 0; f.comboDmg = 0; }

  // rift button: graft tap-toggle + meat wall hold; zenith flare is a hold-modifier read at
  // special start; drain characters tap it to DRINK a pool underfoot or throw the tether.
  tryStanceAndRift(i) {
    const f = this.fighters[i];
    const tr = this.trackers[i];
    const mech = f.char.character.rift_button;
    if (mech.mechanic === 'drain') {
      if (tr.held(B.TH)) return false; // overdrive intent (TH+RF) wins
      if (!this.buffered(i, 'RF', 2)) return false;
      const cfg = mech.config || {};
      // a pool underfoot is drunk first — each pool once per fighter (GDD §5.2)
      for (const p of this.pools) {
        if (!(p.drank & (1 << i)) && Math.abs(f.x - p.x) <= (p.r + (cfg.drinkRange || 20)) * SCALE) {
          this.consume(i, 'RF');
          p.drank |= (1 << i);
          f.hp = Math.min(f.hpMax, f.hp + (cfg.drinkHeal || 30));
          this.gainMeter(f, cfg.drinkMeter || 0);
          f.facts.drinks++;
          this.emit({ t: 'drink', who: i, heal: cfg.drinkHeal || 30, drinks: f.facts.drinks });
          return true;
        }
      }
      const mv = f.char.moves.find(m => m.trigger.type === 'rift_press');
      if (mv && f.drainCd <= 0) {
        this.consume(i, 'RF');
        f.drainCd = mv.cooldown || 120;
        this.startMove(i, mv.id, null);
        return true;
      }
      return false;
    }
    if (mech.mechanic !== 'graft_sets') return false;
    if (tr.rfHeldFrames >= 8 && f.rfCd <= 0 && f.grounded()) {
      // enter Meat Wall
      const mv = f.char.movesById['meat_wall'];
      if (mv) {
        this.setState(f, 'stance', 0);
        f.stancePhase = 'enter';
        f.stanceT = mv.stance.enter;
        this.emit({ t: 'stanceEnter', who: i });
        return true;
      }
    }
    if (tr.released(B.RF) && tr.rfHeldFrames === 0 && f.rfCd <= 0) {
      // it was a tap (released before the 8f hold threshold) — rfHeldFrames already reset by step()
      // use pressAge to confirm a recent press
      if (f.pressAge.RF <= 7) {
        f.gset = f.gset === 'power' ? 'finesse' : 'power';
        f.rfCd = 10;
        this.consume(i, 'RF');
        this.emit({ t: 'setSwap', who: i, set: f.gset });
        return false; // doesn't consume the turn
      }
    }
    return false;
  }

  tickStance(i) {
    const f = this.fighters[i];
    const tr = this.trackers[i];
    const mv = f.char.movesById['meat_wall'];
    f.stanceT--;
    if (f.stancePhase === 'enter') {
      if (f.stanceT <= 0) { f.stancePhase = 'hold'; }
      return;
    }
    if (f.stancePhase === 'hold') {
      if (!tr.held(B.RF)) { f.stancePhase = 'exit'; f.stanceT = mv.stance.exit; }
      return;
    }
    if (f.stancePhase === 'exit') {
      if (f.stanceT <= 0) { f.stancePhase = null; f.rfCd = 12; this.setState(f, 'idle', 0); }
      return;
    }
  }

  // attack starts — priority: overdrive > special (motion) > universal throw > string chain (handled in tickMove) > normal
  tryStartAttack(i) {
    const f = this.fighters[i];
    const tr = this.trackers[i];
    const list = f.char.moves;

    // overdrive: TH+RF held together, one just pressed
    if (f.meter >= this.balance.meter.overdriveCost && tr.held(B.TH) && tr.held(B.RF) &&
      (this.buffered(i, 'TH', 3) || this.buffered(i, 'RF', 3))) {
      const od = list.find(m => m.kind === 'overdrive');
      if (od) {
        this.consume(i, 'TH'); this.consume(i, 'RF');
        f.meter -= this.balance.meter.overdriveCost;
        this.startMove(i, od.id, null);
        this.superFlashT = od.superFlash || 0;
        this.emit({ t: 'overdrive', who: i, move: od.id });
        return true;
      }
    }

    // specials by motion
    const motion = tr.motion();
    if (motion) {
      for (const b of ['FP', 'BP', 'FK', 'BK', 'TH']) {
        if (!this.buffered(i, b, 6)) continue;
        const mv = list.find(m => m.kind === 'special' && m.trigger.type === 'motion' &&
          m.trigger.motion === motion && m.trigger.button === b);
        if (mv) {
          this.consume(i, b);
          const variant = this.pickVariant(i, mv);
          if (variant === 'blocked') return false;
          this.startMove(i, mv.id, variant);
          return true;
        }
      }
    }

    // universal throw
    if (this.buffered(i, 'TH', 2)) {
      this.consume(i, 'TH');
      this.startMove(i, '_throw', null);
      return true;
    }

    // normals / command normals
    const crouching = tr.held(B.D);
    for (const b of ['BK', 'FK', 'BP', 'FP']) {
      if (!this.buffered(i, b, 2)) continue;
      const pos = crouching ? 'crouch' : 'stand';
      const mv = list.find(m => (m.kind === 'normal' || m.kind === 'command_normal') &&
        m.trigger.type === 'button' && m.trigger.button === b && m.trigger.pos === pos);
      if (mv) {
        this.consume(i, b);
        this.startMove(i, mv.id, null);
        return true;
      }
    }
    return false;
  }

  tryStartAirAttack(i) {
    const f = this.fighters[i];
    const tr = this.trackers[i];
    const down = tr.held(B.D);
    for (const b of ['BK', 'FK', 'BP', 'FP']) {
      if (!this.buffered(i, b, 2)) continue;
      const mv = f.char.moves.find(m => m.trigger.type === 'button' && m.trigger.pos === 'air' &&
        m.trigger.button === b && (m.trigger.dir === 'd') === down);
      if (mv) {
        this.consume(i, b);
        this.startMove(i, mv.id, null);
        f.airMoveUsed = true;
        return true;
      }
    }
    return false;
  }

  // EX / Flare selection. returns null | 'ex' | 'flare' | 'blocked'
  pickVariant(i, mv) {
    const f = this.fighters[i];
    const tr = this.trackers[i];
    const mech = f.char.character.rift_button;
    if (mv.variants && mv.variants.flare && mech.mechanic === 'flare' && tr.held(B.RF)) {
      const cost = (mv.variants.flare.cost && mv.variants.flare.cost.debt) || mech.config.debtPerFlare;
      if (f.debt + cost <= mech.config.maxDebt) {
        f.debt += cost;
        f.flaresRound++;
        f.stat.flares++;
        this.emit({ t: 'flare', who: i, debt: f.debt });
        return 'flare';
      }
      // at max debt the Flare fizzles into the base version
      return null;
    }
    if (mv.variants && mv.variants.ex && tr.held(B.BL)) {
      const cost = (mv.variants.ex.cost && mv.variants.ex.cost.meter) || this.balance.meter.exCost;
      if (f.meter >= cost) {
        f.meter -= cost;
        this.emit({ t: 'ex', who: i, move: mv.id });
        return 'ex';
      }
    }
    return null;
  }

  startMove(i, id, variant) {
    const f = this.fighters[i];
    const mv = resolveMove(f.char, id, variant);
    const wasAir = f.state === 'air';
    this.setState(f, 'move', 0);
    f.moveId = id;
    f.moveVar = variant;
    f.moveF = 0;
    f.hitDone = false;
    f.contactMade = false;
    f.contactF = 0;
    f.chainBuf = null;
    f.recoveryAdd = 0;
    f.moveAir = wasAir;
    f.armorLeft = mv.armor ? (mv.armor.hits || 1) : 0;
    f.counterable = true;
    f.projSpawned = false;
    this.emit({ t: 'moveStart', who: i, move: id, variant });
  }

  tickMove(i) {
    const f = this.fighters[i];
    const mv = resolveMove(f.char, f.moveId, f.moveVar);
    f.moveF++;
    const fr = mv.frames;
    const total = fr.startup + fr.active + fr.recovery + f.recoveryAdd;

    // air moves: landing ends them
    if (f.moveAir && f.y <= 0 && f.vy >= 0) {
      this.setState(f, 'land', 6);
      return;
    }

    // self-movement windows
    if (mv.movement) {
      for (const w of mv.movement) {
        if (f.moveF >= w.frames[0] && f.moveF <= w.frames[1]) {
          f.x += w.vx * f.facing;
          f.passThrough = !!w.passThrough;
        }
      }
    }
    if (mv.movement && f.moveF > Math.max(...mv.movement.map(w => w.frames[1]))) f.passThrough = false;

    // projectile spawn at first active frame
    if (mv.projectile && f.moveF === fr.startup + 1 && !f.projSpawned) {
      f.projSpawned = true;
      this.spawnProjectile(i, mv);
    }

    // grab connect check during active window
    if (mv.grab && f.moveF > fr.startup && f.moveF <= fr.startup + fr.active) {
      this.tryGrabConnect(i, mv);
      if (f.state !== 'move') return;
    }

    // parry window end / whiff
    // chain execution: buffered next string hit fires once recovery begins (gapless dial)
    if (f.chainBuf && f.moveF > fr.startup + fr.active) {
      const nxt = f.chainBuf;
      f.chainBuf = null;
      this.startMove(i, nxt, null);
      return;
    }

    if (f.moveF >= total) {
      const wasParry = !!mv.parry;
      this.setState(f, wasParry ? 'idle' : 'idle', 0);
      f.counterable = false;
      f.passThrough = false;
      return;
    }

    // during a move: chain buffering + special cancel (require contact)
    if (f.contactMade) {
      const sinceContact = f.moveF - f.contactF;
      // special / overdrive cancel
      if (mv.cancels && sinceContact <= (mv.cancelWindow || 0)) {
        if (this.tryCancel(i, mv)) return;
      }
      // string chain buffer
      const chains = f.char.chainsFrom[f.moveId];
      if (chains) {
        for (const c of chains) {
          const w = c.trigger.window;
          // buffer tolerance 8: presses landed during hitstop must still chain
          if (sinceContact >= w[0] && sinceContact <= w[1] && this.buffered(i, c.trigger.button, 8)) {
            this.consume(i, c.trigger.button);
            f.chainBuf = c.id;
          }
        }
      }
    }
  }

  tryCancel(i, curMv) {
    const f = this.fighters[i];
    const tr = this.trackers[i];
    // overdrive cancel
    if (curMv.cancels.includes('overdrive') && f.meter >= this.balance.meter.overdriveCost &&
      tr.held(B.TH) && tr.held(B.RF) && (this.buffered(i, 'TH', 3) || this.buffered(i, 'RF', 3))) {
      const od = f.char.moves.find(m => m.kind === 'overdrive');
      if (od) {
        this.consume(i, 'TH'); this.consume(i, 'RF');
        f.meter -= this.balance.meter.overdriveCost;
        this.startMove(i, od.id, null);
        this.superFlashT = od.superFlash || 0;
        this.emit({ t: 'overdrive', who: i, move: od.id });
        return true;
      }
    }
    if (!curMv.cancels.includes('special')) return false;
    const motion = tr.motion();
    if (!motion) return false;
    for (const b of ['FP', 'BP', 'FK', 'BK', 'TH']) {
      if (!this.buffered(i, b, 8)) continue;
      const mv = f.char.moves.find(m => m.kind === 'special' && m.trigger.type === 'motion' &&
        m.trigger.motion === motion && m.trigger.button === b);
      if (mv && !mv.grab) { // no command-grab cancels (grapplers earn their grabs raw)
        this.consume(i, b);
        const variant = this.pickVariant(i, mv);
        this.startMove(i, mv.id, variant);
        this.emit({ t: 'cancel', who: i, into: mv.id });
        return true;
      }
    }
    return false;
  }

  // ---------------- physics

  integrate(i) {
    const f = this.fighters[i];
    const tr = this.trackers[i];
    const st = f.stats;
    const cfgMod = this.walkMod(f);

    switch (f.state) {
      case 'walkF': f.x += trunc(st.walkF * cfgMod, 1000) * f.facing; break;
      case 'walkB': f.x -= trunc(st.walkB * cfgMod, 1000) * f.facing; break;
      case 'dashF': if (f.stateT <= st.dashF.dur) f.x += st.dashF.speed * f.facing; break;
      case 'dashB': if (f.stateT <= st.dashB.dur) f.x -= st.dashB.speed * f.facing; break;
      case 'wakeup': {
        if (f.wakeRoll) f.x -= trunc(this.balance.wakeup.rollDist * SCALE, this.balance.wakeup.rollFrames) * f.facing;
        break;
      }
      case 'hitstun': case 'blockstun': {
        if (f.pushVx) {
          f.x += f.pushVx;
          f.pushVx = trunc(f.pushVx * 82, 100);
          if (Math.abs(f.pushVx) < 200) f.pushVx = 0;
        }
        break;
      }
    }

    // air physics — the single integration point (y positive-up, vy negative = rising)
    if (f.state === 'air' || f.state === 'launched') {
      const g = f.state === 'launched' ? this.balance.juggle.reGravity : st.gravity;
      f.x += f.vx;
      f.y += -f.vy;
      f.vy += g;
      if (f.y <= 0 && f.vy > 0) {
        f.y = 0; f.vx = 0; f.vy = 0;
        if (f.state === 'launched') {
          const kd = f.kdHard ? this.balance.wakeup.hardKdFrames : this.balance.wakeup.kdFrames;
          this.setState(f, 'kd', kd);
          f.kdDelayed = false;
          this.emit({ t: 'land', who: i, hard: f.kdHard });
          this.resetCombo(f);
          this.other(i).counterable = false;
        } else {
          this.setState(f, 'land', 4);
        }
      }
    }

    // attacker pushback echo (cornered victim pushes attacker)
    if (f.pushVxSelf) {
      f.x += f.pushVxSelf;
      f.pushVxSelf = trunc(f.pushVxSelf * 82, 100);
      if (Math.abs(f.pushVxSelf) < 200) f.pushVxSelf = 0;
    }
  }

  walkMod(f) {
    let mod = 1000;
    if (f.char.character.rift_button.mechanic === 'graft_sets') {
      const cfg = f.char.character.rift_button.config;
      mod = f.gset === 'power' ? cfg.power.walkPermille : cfg.finesse.walkPermille;
    }
    if (f.sundered.LEGS) mod = trunc(mod * 850, 1000); // Sundered LEGS: -15% speed
    return mod;
  }

  clampAndPush() {
    const W = this.arena.width * SCALE;
    const [a, b] = this.fighters;
    for (const f of this.fighters) {
      const hw = trunc(f.stats.width * SCALE, 2);
      if (f.x < hw) f.x = hw;
      if (f.x > W - hw) f.x = W - hw;
    }
    // pushbox separation (both grounded-ish, no passThrough)
    if (!a.passThrough && !b.passThrough && a.y <= 0 && b.y <= 0 &&
      a.state !== 'kd' && b.state !== 'kd' && a.state !== 'grabbed' && b.state !== 'grabbed' &&
      a.state !== 'thrown' && b.state !== 'thrown') {
      const need = trunc((a.stats.width + b.stats.width) * SCALE, 2);
      const dx = b.x - a.x;
      const gap = Math.abs(dx) - need;
      if (gap < 0) {
        const push = trunc(-gap, 2) + 1;
        const dir = dx >= 0 ? 1 : -1;
        const W2 = this.arena.width * SCALE;
        const ahw = trunc(a.stats.width * SCALE, 2), bhw = trunc(b.stats.width * SCALE, 2);
        let aNew = a.x - dir * push, bNew = b.x + dir * push;
        if (aNew < ahw) { bNew += (ahw - aNew); aNew = ahw; }
        if (bNew > W2 - bhw) { aNew -= (bNew - (W2 - bhw)); bNew = W2 - bhw; }
        if (aNew < ahw) aNew = ahw;
        a.x = aNew; b.x = bNew;
      }
    }
  }

  updateFacing() {
    const [a, b] = this.fighters;
    for (const f of this.fighters) {
      const o = this.other(f.id);
      if (f.grounded() && (f.neutralGround() || f.state === 'land')) {
        f.facing = o.x >= f.x ? 1 : -1;
      }
    }
  }

  // ---------------- projectiles

  spawnProjectile(i, mv) {
    const f = this.fighters[i];
    const p = mv.projectile;
    this.projectiles.push({
      id: this.nextProjId++,
      owner: i, moveId: mv.id, variant: f.moveVar,
      x: f.x + f.facing * trunc((f.stats.width + p.w) * SCALE, 2),
      y: p.y * SCALE,
      vx: p.speed * f.facing,
      w: p.w, h: p.h,
      life: p.life,
      durability: p.durability || 1,
      pierce: !!p.pierce,
      hitIds: [],
      damage: mv.damage, chip: mv.chip,
      age: 0
    });
    this.emit({ t: 'projSpawn', who: i, move: mv.id, x: trunc(f.x, SCALE) });
  }

  advanceProjectiles() {
    const W = this.arena.width * SCALE;
    for (const p of this.projectiles) {
      p.x += p.vx;
      p.age++;
      if (p.age > p.life || p.x < -50 * SCALE || p.x > W + 50 * SCALE) p.dead = true;
    }
    // clash
    for (const p of this.projectiles) {
      if (p.dead) continue;
      for (const q of this.projectiles) {
        if (q.dead || q.owner === p.owner || q.id <= p.id) continue;
        if (this.boxOverlap(
          p.x - trunc(p.w * SCALE, 2), p.y - trunc(p.h * SCALE, 2), p.w * SCALE, p.h * SCALE,
          q.x - trunc(q.w * SCALE, 2), q.y - trunc(q.h * SCALE, 2), q.w * SCALE, q.h * SCALE)) {
          if (!p.pierce) p.durability--;
          if (!q.pierce) q.durability--;
          if (p.durability <= 0) p.dead = true;
          if (q.durability <= 0) q.dead = true;
          this.emit({ t: 'clash', x: trunc((p.x + q.x) / 2, SCALE), y: trunc(p.y, SCALE) });
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.dead);
  }

  boxOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 && x2 < x1 + w1 && y1 < y2 + h2 && y2 < y1 + h1;
  }

  // ---------------- combat

  hurtboxesOf(f) {
    const hb = f.char.character.hurtboxes;
    if (f.state === 'kd' || f.state === 'wakeup' && !f.wakeRoll) {
      return [{ x: -45, y: 0, w: 90, h: 55 }];
    }
    if (f.y > 0 || f.state === 'air' || f.state === 'launched') return hb.air;
    if (f.state === 'crouch' || (f.state === 'move' && f.moveId &&
      (f.char.movesById[f.moveId].trigger || {}).pos === 'crouch')) return hb.crouch;
    return hb.stand;
  }

  worldBoxes(f, boxes) {
    return boxes.map(b => ({
      x: f.x + f.facing * b.x * SCALE - (f.facing < 0 ? b.w * SCALE : 0),
      y: f.y + b.y * SCALE,
      w: b.w * SCALE, h: b.h * SCALE
    }));
  }

  strikeInvuln(vic, atk, isProjectile) {
    if (vic.invulnT > 0) return true;
    if (vic.state === 'move') {
      const mv = resolveMove(vic.char, vic.moveId, vic.moveVar);
      if (mv.invuln) {
        const [a, b] = mv.invuln.frames;
        if (vic.moveF >= a && vic.moveF <= b) {
          if (mv.invuln.vs === 'all') return true;
          if (mv.invuln.vs === 'air' && (atk.y > 0 || isProjectile === 'air')) return true;
        }
      }
    }
    return false;
  }

  collectContacts() {
    const out = [];
    // melee strikes
    for (let i = 0; i < 2; i++) {
      const f = this.fighters[i];
      if (f.state !== 'move' || f.hitDone) continue;
      const mv = resolveMove(f.char, f.moveId, f.moveVar);
      if (!mv.hitboxes || mv.grab) continue;
      const fr = mv.frames;
      const rel = f.moveF - fr.startup;
      if (rel < 1 || rel > fr.active) continue;
      const vic = this.other(i);
      if (['ko', 'grabbed', 'thrown', 'kd', 'wakeup'].includes(vic.state)) continue;
      let boxes = mv.hitboxes.filter(hb => rel >= hb.frames[0] && rel <= hb.frames[1]);
      if (!boxes.length) continue;
      // graft finesse long-arm extension
      if (mv.finesseExtendW && f.gset === 'finesse') {
        boxes = boxes.map(b => ({ ...b, w: b.w + mv.finesseExtendW }));
      }
      const world = mv.atOpponent
        ? boxes.map(b => ({ x: vic.x + b.x * SCALE, y: b.y * SCALE, w: b.w * SCALE, h: b.h * SCALE }))
        : this.worldBoxes(f, boxes);
      const vicHurt = this.hurtboxesOf(vic).map(b => ({
        x: vic.x + vic.facing * b.x * SCALE - (vic.facing < 0 ? b.w * SCALE : 0),
        y: vic.y + b.y * SCALE, w: b.w * SCALE, h: b.h * SCALE
      }));
      let touch = false;
      for (const wb of world) {
        for (const vb of vicHurt) {
          if (this.boxOverlap(wb.x, wb.y, wb.w, wb.h, vb.x, vb.y, vb.w, vb.h)) { touch = true; break; }
        }
        if (touch) break;
      }
      if (!touch) continue;
      if (this.strikeInvuln(vic, f, f.y > 0 ? 'air' : 'ground')) continue;
      out.push({ kind: 'strike', atk: i, mv });
    }
    // projectiles vs fighters
    for (const p of this.projectiles) {
      const vic = this.fighters[1 - p.owner];
      if (p.hitIds.includes(vic.id)) continue;
      if (vic.state === 'ko' || vic.state === 'grabbed' || vic.state === 'thrown' || vic.state === 'kd') continue;
      const vicHurt = this.hurtboxesOf(vic).map(b => ({
        x: vic.x + vic.facing * b.x * SCALE - (vic.facing < 0 ? b.w * SCALE : 0),
        y: vic.y + b.y * SCALE, w: b.w * SCALE, h: b.h * SCALE
      }));
      const px = p.x - trunc(p.w * SCALE, 2), py = p.y - trunc(p.h * SCALE, 2);
      let touch = false;
      for (const vb of vicHurt) {
        if (this.boxOverlap(px, py, p.w * SCALE, p.h * SCALE, vb.x, vb.y, vb.w, vb.h)) { touch = true; break; }
      }
      if (!touch) continue;
      if (this.strikeInvuln(vic, this.fighters[p.owner], 'ground')) continue;
      out.push({ kind: 'proj', atk: p.owner, p });
    }
    return out;
  }

  applyContacts(contacts) {
    for (const c of contacts) {
      if (c.kind === 'strike') this.resolveStrike(c.atk, c.mv, null);
      else this.resolveStrike(c.atk, resolveMove(this.fighters[c.atk].char, c.p.moveId, c.p.variant), c.p);
    }
  }

  resolveStrike(ai, mv, proj) {
    const atk = this.fighters[ai];
    const vic = this.other(ai);
    const adds = mv.adds || [];

    // 1) parry?
    if (!proj && vic.state === 'move') {
      const vmv = resolveMove(vic.char, vic.moveId, vic.moveVar);
      if (vmv.parry) {
        const [a, b] = vmv.parry.frames; // relative to active start
        const rel = vic.moveF - vmv.frames.startup;
        const inWin = rel >= a && rel <= b;
        if (inWin && vmv.parry.vs.includes(mv.guard)) {
          // PARRIED
          atk.recoveryAdd += vmv.parry.staggerAdd || 16;
          atk.counterable = true;
          if (atk.state === 'move') atk.hitDone = true;
          vic.stat.parries++;
          const cfg = vic.char.character.rift_button.config || {};
          if (vic.char.character.rift_button.mechanic === 'flare' && vic.debt >= (cfg.parryRefundDebt || 10)) {
            vic.debt -= cfg.parryRefundDebt || 10;
          } else {
            this.gainMeter(vic, cfg.parryRefundMeter || 50);
          }
          this.setState(vic, 'idle', 0);
          this.hitstopT = Math.max(this.hitstopT, 9);
          this.emit({ t: 'parry', who: vic.id, vs: mv.id });
          this.checkSunders(vic, atk, { kind: 'parry', uses: mv.uses || 'ARMS' });
          return;
        }
      }
    }

    // 2) meat wall absorb / graft armor
    const wall = vic.state === 'stance' && vic.stancePhase === 'hold';
    const gcfg = vic.char.character.rift_button.mechanic === 'graft_sets' ? vic.char.character.rift_button.config : null;
    if (proj && wall && gcfg && !adds.includes('armor_break')) {
      vic.graftHp = Math.min(gcfg.poolMax, vic.graftHp + gcfg.absorbHeal);
      vic.stat.absorbed++;
      vic.facts.absorbs++;
      proj.dead = true;
      this.projectiles = this.projectiles.filter(p => !p.dead);
      this.hitstopT = Math.max(this.hitstopT, 4);
      this.emit({ t: 'absorb', who: vic.id, heal: gcfg.absorbHeal });
      return;
    }
    let armored = false;
    if (!adds.includes('armor_break') && gcfg && vic.graftHp > 0) {
      if (wall) armored = true;
      else if (vic.state === 'move') {
        const vmv = resolveMove(vic.char, vic.moveId, vic.moveVar);
        if (vmv.armor && vic.armorLeft > 0 && (!vmv.armorSet || vmv.armorSet === vic.gset)) {
          const [a2, b2] = vmv.armor.frames;
          if (vic.moveF >= a2 && vic.moveF <= b2) { armored = true; vic.armorLeft--; }
        }
      }
    }
    if (armored) {
      const dmgToPool = proj ? proj.damage : mv.damage;
      vic.graftHp = Math.max(0, vic.graftHp - dmgToPool);
      vic.facts.absorbs++;
      const real = Math.max(1, trunc(dmgToPool * gcfg.armorDamagePermille, 1000));
      this.damage(vic, real, 'hit', ai);
      if (proj) { proj.hitIds.push(vic.id); if (!proj.pierce) { proj.durability--; if (proj.durability <= 0) proj.dead = true; } }
      else atk.hitDone = true;
      this.hitstopT = Math.max(this.hitstopT, 6);
      this.bloodEvent(vic, 12, 1);
      this.emit({ t: 'armor', who: vic.id, pool: vic.graftHp });
      this.projectiles = this.projectiles.filter(p => !p.dead);
      return;
    }

    // 3) block?
    const tr = this.trackers[vic.id];
    const guardReady = vic.grounded() &&
      (['idle', 'walkF', 'walkB', 'crouch', 'land', 'blockstun'].includes(vic.state));
    if (guardReady && tr.held(B.BL) && mv.guard !== 'unblockable' && mv.guard !== 'throw') {
      const crouchBlock = tr.held(B.D);
      const guarded = mv.guard === 'mid' || (mv.guard === 'low' && crouchBlock) || (mv.guard === 'overhead' && !crouchBlock);
      if (guarded) {
        const chip = mv.chip || 0;
        if (chip > 0) {
          const clamp = this.balance.bleed.chipClampHp;
          vic.hp = Math.max(clamp, vic.hp - chip);
        }
        // blocking a low opens the attacker to a Sunder punish (zenith LEGS trigger)
        if (mv.guard === 'low' && atk.state === 'move' && !proj) atk.lowPunishable = true;
        vic.state = 'blockstun';
        vic.stateT = 0;
        vic.stunT = Math.max(vic.stunT, mv.frames.blockstun || 12);
        this.applyPushback(vic, atk, mv, 'block');
        this.gainMeter(atk, (mv.meterGain && mv.meterGain.block) || 0);
        // "every blocked string leaks a little life to him" — chip lifesteal
        if (mv.lifesteal && chip > 0 && atk.hp > 0) {
          const heal = trunc(chip * mv.lifesteal, 1000);
          if (heal > 0) {
            atk.hp = Math.min(atk.hpMax, atk.hp + heal);
            this.emit({ t: 'drain', who: atk.id, amt: heal });
          }
        }
        if (atk.state === 'move' && !proj) { atk.hitDone = true; atk.contactMade = true; atk.contactF = atk.moveF; }
        if (proj) { proj.hitIds.push(vic.id); if (!proj.pierce) { proj.durability--; if (proj.durability <= 0) proj.dead = true; } }
        this.hitstopT = Math.max(this.hitstopT, Math.max(2, (mv.frames.hitstop || 5) - 2));
        this.emit({ t: 'block', who: vic.id, move: mv.id, chip });
        this.projectiles = this.projectiles.filter(p => !p.dead);
        return;
      }
    }

    // 4) HIT
    const counter = vic.state === 'move' && vic.counterable;
    // pre-stun facts for the Sunder triggers (state changes below would erase them)
    const vicWasInMove = vic.state === 'move';
    const vicLowPunish = vic.lowPunishable;
    let baseDmg = proj ? proj.damage : mv.damage;
    if (atk.sundered.ARMS && (mv.uses || 'ARMS') === 'ARMS') baseDmg = trunc(baseDmg * 800, 1000); // Sundered ARMS
    const scaleIdx = Math.min(vic.comboHits, this.balance.comboScaling.length - 1);
    let dmg = trunc(baseDmg * this.balance.comboScaling[scaleIdx], 1000);
    if (counter) dmg = trunc(dmg * (1000 + this.balance.counterHit.damageBonusPermille), 1000);
    dmg = Math.max(1, dmg);

    this.damage(vic, dmg, 'hit', ai);
    atk.stat.dmgDealt += dmg;
    vic.comboHits++;
    vic.comboDmg += dmg;
    if (vic.sundered.HEAD) vic.concussT = 25;
    this.gainMeter(atk, (mv.meterGain && mv.meterGain.hit) || 0);
    this.gainMeter(vic, trunc(dmg * this.balance.meter.takeDamagePerHundred, 100));
    // drain identity (v1.1): lifesteal + meter theft
    if (mv.lifesteal) {
      const heal = trunc(dmg * mv.lifesteal, 1000);
      if (heal > 0 && atk.hp > 0) {
        atk.hp = Math.min(atk.hpMax, atk.hp + heal);
        this.emit({ t: 'drain', who: ai, amt: heal });
      }
    }
    if (mv.meterSteal) {
      const st = Math.min(vic.meter, mv.meterSteal);
      if (st > 0) { vic.meter -= st; this.gainMeter(atk, st); }
    }

    // trauma ledger
    const region = mv.limb_tag || 'BODY';
    const before = vic.woundState(region);
    vic.trauma[region] += dmg;
    const after = vic.woundState(region);
    if (after > before) {
      this.emit({ t: 'wound', who: vic.id, region, state: after });
      if (after === 3 && !vic.bleedRegions.includes(region)) {
        vic.bleedRegions.push(region);
        this.emit({ t: 'bleeding', who: vic.id, region });
      }
    }

    // burn (ignite)
    if (adds.includes('ignite')) vic.burnT = BURN_T;

    // knock / stun
    let knock = mv.knock || { type: 'none' };
    if (knock.onCounterOnly && !counter) knock = { type: 'down', vx: knock.vx || 3000 };
    const airborneVic = vic.y > 0 || vic.state === 'launched' || vic.state === 'air';

    if (airborneVic) {
      // juggle: any hit keeps them airborne
      vic.state = 'launched';
      vic.stateT = 0;
      vic.vy = knock.vy !== undefined && knock.type !== 'none' ? knock.vy : -6000;
      vic.vx = (knock.vx !== undefined ? knock.vx : 2000) * atk.facing;
      vic.kdHard = knock.type === 'hardDown';
    } else {
      switch (knock.type) {
        case 'launch':
          vic.state = 'launched'; vic.stateT = 0;
          vic.vy = knock.vy || this.balance.juggle.liftVy;
          vic.vx = (knock.vx || 0) * atk.facing;
          vic.kdHard = false;
          break;
        case 'groundBounce':
          vic.state = 'launched'; vic.stateT = 0;
          vic.vy = knock.vy || -9500;
          vic.vx = (knock.vx || 0) * atk.facing;
          vic.kdHard = false;
          this.emit({ t: 'bounce', who: vic.id });
          break;
        case 'down': case 'hardDown':
          vic.state = 'launched'; vic.stateT = 0;
          vic.vy = knock.vy || -5000;
          vic.vx = (knock.vx || 4000) * atk.facing;
          vic.kdHard = knock.type === 'hardDown';
          break;
        case 'back': {
          vic.state = 'hitstun'; vic.stateT = 0;
          vic.stunT = (mv.frames.hitstun || 20) + (counter ? this.balance.counterHit.hitstunBonus : 0);
          vic.pushVx = trunc((knock.vx || 10000), 8) * atk.facing;
          break;
        }
        default: {
          vic.state = 'hitstun'; vic.stateT = 0;
          vic.stunT = (mv.frames.hitstun || 16) + (counter ? this.balance.counterHit.hitstunBonus : 0);
          this.applyPushback(vic, atk, mv, 'hit');
        }
      }
    }

    if (atk.state === 'move' && !proj) { atk.hitDone = true; atk.contactMade = true; atk.contactF = atk.moveF; }
    if (proj) { proj.hitIds.push(vic.id); if (!proj.pierce) { proj.durability--; if (proj.durability <= 0) proj.dead = true; } }
    this.projectiles = this.projectiles.filter(p => !p.dead);

    this.hitstopT = Math.max(this.hitstopT, mv.frames.hitstop || 5);

    // blood
    const impactY = vic.y > 0 ? trunc(vic.y, SCALE) + 120 : 130;
    this.bloodEvent(vic, dmg, vic.woundState(region));
    if (dmg >= this.balance.blood.poolDamageMin || knock.type === 'down' || knock.type === 'hardDown' || knock.type === 'launch') {
      this.addPool(vic.x, Math.max(30, dmg));
    }

    this.emit({
      t: 'hit', who: vic.id, by: ai, move: mv.id, dmg, counter,
      combo: vic.comboHits, x: trunc(vic.x, SCALE), y: impactY, region
    });

    // sunder triggers ride on the landed hit
    atk.facts.mhits[mv.id] = (atk.facts.mhits[mv.id] || 0) + 1;
    this.checkSunders(atk, vic, {
      kind: 'hit', moveId: mv.id,
      variant: proj ? proj.variant : atk.moveVar,
      projAge: proj ? proj.age : undefined,
      vicInMove: vicWasInMove, vicLowPunish
    });
  }

  // ---------------- sunders (P3)

  checkSunders(atk, vic, ctx) {
    const list = atk.char.sunders;
    if (!list) return;
    for (const def of list) {
      if (vic.sundered[def.region]) continue;
      const w = def.when;
      if (!w) continue;
      let fire = false;
      switch (w.type) {
        case 'parry_vs_uses':
          fire = ctx.kind === 'parry' && ctx.uses === w.uses;
          break;
        case 'punish_blocked_low':
          fire = ctx.kind === 'hit' && ctx.vicLowPunish && ctx.vicInMove;
          break;
        case 'proj_hit':
          fire = ctx.kind === 'hit' && ctx.moveId === w.move &&
            (!w.variant || ctx.variant === w.variant) && (ctx.projAge || 0) >= (w.minAge || 0);
          break;
        case 'move_hits':
          fire = (ctx.kind === 'hit' || ctx.kind === 'grab') && ctx.moveId === w.move &&
            (atk.facts.mhits[w.move] || 0) >= w.count;
          break;
        case 'absorb_punish':
          fire = ctx.kind === 'hit' && atk.facts.absorbs >= w.absorbs && ctx.vicInMove;
          break;
        case 'hit_region_sundered':
          fire = (ctx.kind === 'hit' || ctx.kind === 'grab') && (!w.move || ctx.moveId === w.move) &&
            vic.sundered[w.region];
          break;
        case 'pools_drunk':
          fire = ctx.kind === 'hit' && atk.facts.drinks >= (w.drinks || 3);
          break;
      }
      if (fire) { this.fireSunder(atk, vic, def); return; } // one per contact
    }
  }

  fireSunder(atk, vic, def) {
    vic.sundered[def.region] = true;
    if (def.region === 'BODY' && !vic.bleedRegions.includes('BODY')) {
      vic.bleedRegions.push('BODY'); // GDD §6: Sundered BODY applies Bleeding
      this.emit({ t: 'bleeding', who: vic.id, region: 'BODY' });
    }
    // cinematic-lite: long freeze, heavy blood, the floor drinks
    this.hitstopT = Math.max(this.hitstopT, 46);
    this.bloodEvent(vic, 90, 3);
    this.addPool(vic.x, 120);
    if (vic.state !== 'launched' && vic.state !== 'kd' && vic.y <= 0) {
      vic.state = 'launched'; vic.stateT = 0;
      vic.vy = -6500; vic.vx = 3500 * atk.facing; vic.kdHard = false;
    }
    this.emit({ t: 'sunder', who: vic.id, by: atk.id, region: def.region, name: def.id, flavor: def.flavor || '' });
  }

  damage(vic, amount, cause, byId) {
    vic.hp -= amount;
    vic.lastCause = cause;
    vic.dashWant = null; // getting hit eats buffered dashes
    if (vic.hp < 0) vic.hp = 0;
  }

  applyPushback(vic, atk, mv, kind) {
    const base = (mv.pushback && mv.pushback[kind]) || this.balance.pushbackDefault[kind];
    const W = this.arena.width * SCALE;
    const hw = trunc(vic.stats.width * SCALE, 2);
    const dir = atk.facing;
    const cornered = (vic.x <= hw + 2000 && dir < 0) || (vic.x >= W - hw - 2000 && dir > 0);
    if (cornered) {
      atk.pushVxSelf = trunc(base, 8) * -dir;
    } else {
      vic.pushVx = trunc(base, 8) * dir;
    }
  }

  // ---------------- grabs

  tryGrabConnect(i, mv) {
    const atk = this.fighters[i];
    const vic = this.other(i);
    if (!vic.grabbable()) return;
    if (vic.y > 0 && !mv.grab.airOk) return;
    const gap = trunc(Math.abs(vic.x - atk.x), SCALE) - trunc(atk.stats.width + vic.stats.width, 2);
    if (gap > mv.grab.range) return;
    // connect
    atk.state = 'grabbing';
    atk.stateT = 0;
    atk.grabT = mv.grab.cinematicFrames;
    atk.grabMove = mv.id;
    atk.grabVar = atk.moveVar;
    atk.mashCount = 0;
    vic.state = mv.id === '_throw' ? 'thrown' : 'grabbed';
    vic.stateT = 0;
    // Sundered ARMS on the grabber: their throws tech twice as easily
    vic.techT = mv.techable ? vic.char.character.throw.techWindow * (atk.sundered.ARMS ? 2 : 1) : 0;
    vic.moveId = null;
    // snap victim to grab range
    vic.x = atk.x + atk.facing * trunc((atk.stats.width + vic.stats.width) * SCALE, 2);
    vic.facing = -atk.facing;
    this.emit({ t: 'grabConnect', who: i, move: mv.id });
  }

  tickGrabs() {
    for (let i = 0; i < 2; i++) {
      const atk = this.fighters[i];
      if (atk.state !== 'grabbing') continue;
      const vic = this.other(i);
      const mv = resolveMove(atk.char, atk.grabMove, atk.grabVar);
      const tr = this.trackers[vic.id];

      // throw tech
      if (vic.state === 'thrown' && vic.techT > 0) {
        vic.techT--;
        if (tr.pressed(B.TH)) {
          // TECHED — brief mutual lag via the land state
          vic.stat.throwsTeched++;
          this.setState(atk, 'land', 14);
          this.setState(vic, 'land', 14);
          atk.pushVxSelf = -atk.facing * 2600;
          vic.pushVx = atk.facing * 2600;
          this.hitstopT = Math.max(this.hitstopT, 6);
          this.emit({ t: 'throwTech', who: vic.id });
          continue;
        }
      }
      // mash resist on command grabs
      if (vic.state === 'grabbed' && mv.grab.mashReduce > 0) {
        for (const b of ['FP', 'BP', 'FK', 'BK']) {
          if (tr.pressed(B[b])) atk.mashCount++;
        }
      }

      atk.grabT--;
      if (atk.grabT <= 0) {
        let dmg = Math.max(mv.grab.damageFloor, mv.damage - atk.mashCount * mv.grab.mashReduce);
        if (atk.sundered.ARMS && (mv.uses || 'ARMS') === 'ARMS') dmg = trunc(dmg * 800, 1000);
        this.damage(vic, dmg, 'hit', i);
        atk.stat.dmgDealt += dmg;
        if (vic.sundered.HEAD) vic.concussT = 25;
        this.gainMeter(atk, (mv.meterGain && mv.meterGain.hit) || 0);
        this.gainMeter(vic, trunc(dmg * this.balance.meter.takeDamagePerHundred, 100));
        if (mv.lifesteal) {
          const heal = trunc(dmg * mv.lifesteal, 1000);
          if (heal > 0) {
            atk.hp = Math.min(atk.hpMax, atk.hp + heal);
            this.emit({ t: 'drain', who: i, amt: heal });
          }
        }
        const region = mv.limb_tag || 'BODY';
        const before = vic.woundState(region);
        vic.trauma[region] += dmg;
        if (vic.woundState(region) === 3 && before < 3 && !vic.bleedRegions.includes(region)) {
          vic.bleedRegions.push(region);
          this.emit({ t: 'bleeding', who: vic.id, region });
        }
        vic.state = 'launched';
        vic.stateT = 0;
        vic.vy = (mv.knock && mv.knock.vy) || -7000;
        vic.vx = ((mv.knock && mv.knock.vx) || 6000) * atk.facing;
        vic.kdHard = mv.knock && mv.knock.type === 'hardDown';
        this.setState(atk, 'land', 12); // recovery lag after the slam
        this.hitstopT = Math.max(this.hitstopT, 10);
        this.bloodEvent(vic, dmg, 2);
        this.addPool(vic.x, Math.max(40, dmg));
        this.emit({ t: 'grabHit', who: vic.id, by: i, move: mv.id, dmg, x: trunc(vic.x, SCALE) });
        atk.facts.mhits[mv.id] = (atk.facts.mhits[mv.id] || 0) + 1;
        this.checkSunders(atk, vic, { kind: 'grab', moveId: mv.id, variant: atk.grabVar });
      }
    }
  }

  // ---------------- breaker

  checkBreaker(only) {
    for (let i = 0; i < 2; i++) {
      if (only !== undefined && i !== only) continue;
      const f = this.fighters[i];
      if (f.state !== 'hitstun' && f.state !== 'launched') continue;
      if (f.meter < this.balance.meter.breakerCost) continue;
      const tr = this.trackers[i];
      if (tr.held(B.BL) && tr.held(B.TH) && (tr.pressed(B.TH) || tr.pressed(B.BL))) {
        f.meter -= this.balance.meter.breakerCost;
        const atk = this.other(i);
        this.setState(f, f.y > 0 ? 'launched' : 'idle', 0);
        if (f.y > 0) { f.vy = -3000; f.vx = 0; f.kdHard = false; }
        f.stunT = 0;
        f.invulnT = 22;
        this.resetCombo(f);
        atk.pushVxSelf = -atk.facing * 3200;
        this.hitstopT = Math.max(this.hitstopT, 8);
        this.emit({ t: 'breaker', who: i });
      }
    }
  }

  // ---------------- living blood

  bloodEvent(vic, volume, tier) {
    this.emit({
      t: 'blood', who: vic.id, x: trunc(vic.x, SCALE), y: vic.y > 0 ? trunc(vic.y, SCALE) + 130 : 130,
      vol: volume, tier: tier || 0
    });
  }

  addPool(xMilli, volume) {
    const b = this.balance.pools;
    if (volume < trunc(b.minEventVolume, 1)) return;
    // merge with nearest pool in range
    let best = null, bestD = b.mergeDist * SCALE;
    for (const p of this.pools) {
      const d = Math.abs(p.x - xMilli);
      if (d <= bestD) { best = p; bestD = d; }
    }
    if (best) {
      const tot = best.vol + volume;
      best.x = trunc(best.x * best.vol + xMilli * volume, tot);
      best.vol = tot;
    } else {
      this.pools.push({ x: xMilli, vol: volume, drank: 0 });
    }
    for (const p of this.pools) {
      p.r = Math.min(b.maxRadius, 26 + trunc(p.vol * b.radiusPerVolume, SCALE));
    }
    this.emit({ t: 'pool', x: trunc(xMilli, SCALE) });
  }

  tickPools() {
    const b = this.balance.pools;
    const scar = this.arena.scarX * SCALE;
    for (const p of this.pools) {
      if (Math.abs(p.x - scar) > 2000) p.x += p.x < scar ? b.migratePerFrame : -b.migratePerFrame;
    }
    const amp = this.arena.poolAmp || 1000;
    for (const f of this.fighters) {
      let inPool = false;
      if (f.grounded()) {
        for (const p of this.pools) {
          if (Math.abs(f.x - p.x) <= p.r * SCALE) { inPool = true; break; }
        }
      }
      if (inPool) {
        f.poolTickT++;
        if (f.poolTickT >= b.tickInterval) {
          f.poolTickT = 0;
          this.gainMeter(f, trunc(b.tickMeter * amp, 1000));
          this.emit({ t: 'poolTick', who: f.id });
        }
      } else f.poolTickT = 0;
    }
  }

  tickDots() {
    for (const f of this.fighters) {
      if (f.state === 'ko') continue;
      // bleeding: can KO (Bleed-out)
      const n = f.bleedRegions.length;
      if (n > 0) {
        f.bleedAcc += n * this.balance.bleed.dripPer60;
        while (f.bleedAcc >= 60) {
          f.bleedAcc -= 60;
          if (f.hp > 0) { f.hp -= 1; f.lastCause = 'bleed'; }
        }
      }
      // burn: chip-class, clamps at 1
      if (f.burnT > 0) {
        f.burnT--;
        if (f.burnT % BURN_STEP === 0 && f.hp > this.balance.bleed.chipClampHp) {
          f.hp -= 1;
          f.lastCause = 'burn';
        }
      }
    }
  }

  // ---------------- rounds

  tickTimer() {
    if (this.frame % 60 === 0 && this.timer > 0) this.timer--;
  }

  checkRound() {
    if (this.phase !== 'fight') return;
    const [a, b] = this.fighters;
    let winner = -1, reason = null;
    if (a.hp <= 0 && b.hp <= 0) { winner = 2; reason = a.lastCause === 'bleed' || b.lastCause === 'bleed' ? 'bleedout' : 'ko'; }
    else if (a.hp <= 0) { winner = 1; reason = a.lastCause === 'bleed' ? 'bleedout' : 'ko'; }
    else if (b.hp <= 0) { winner = 0; reason = b.lastCause === 'bleed' ? 'bleedout' : 'ko'; }
    else if (this.timer <= 0) {
      if (a.hp === b.hp) { winner = 2; reason = 'timeout'; }
      else { winner = a.hp > b.hp ? 0 : 1; reason = 'timeout'; }
    }
    if (winner === -1) return;

    this.roundWinner = winner;
    this.roundReason = reason;
    this.phase = 'roundEnd';
    this.phaseT = 150;
    this.finalRound = false;
    if (winner !== 2) {
      this.roundWins[winner]++;
      this.finalRound = this.roundWins[winner] >= this.balance.rounds.toWin;
      const wf = this.fighters[winner];
      // effect DSL: round_won rules (match-scoped)
      this.applyRules(wf, 'round_won', { flares_this_round: wf.flaresRound });
      const loser = this.other(winner);
      if (loser.state !== 'launched' && loser.state !== 'kd') {
        loser.state = 'launched'; loser.vy = -6000; loser.vx = -loser.facing * 3000; loser.kdHard = true;
      }
      this.emit({ t: 'roundEnd', winner, reason, final: this.finalRound });
    } else {
      this.emit({ t: 'roundEnd', winner: 2, reason });
    }
  }

  phaseTick() {
    this.phaseT--;
    if (this.phase === 'intro' && this.phaseT <= 0) {
      this.phase = 'fight';
      this.emit({ t: 'fight' });
      return;
    }
    if (this.phase === 'roundEnd') {
      // let physics settle the loser
      for (let i = 0; i < 2; i++) this.integrate(i);
      this.clampAndPush();
      if (this.phaseT <= 0) {
        if (this.finalRound) this.enterFinish();
        else this.resetRound();
      }
      return;
    }
    if (this.phase === 'finish') {
      for (let i = 0; i < 2; i++) this.integrate(i);
      this.clampAndPush();
      const w = this.roundWinner;
      if (!this.executed) {
        const human = !this.fighters[w].ai;
        const elapsed = 480 - this.phaseT;
        if (human ? this.trackers[w].pressed(B.RF)
          : (this.finishCpu >= 0 && elapsed >= this.finishCpu)) {
          this.executed = true;
          const exs = this.fighters[w].char.finishers;
          const ex = exs && exs.executions && exs.executions[0];
          const loser = this.other(w);
          // the Rift is fed: the arena drinks the loser
          this.bloodEvent(loser, 240, 3);
          this.addPool(loser.x, 340);
          this.emit({ t: 'execution', winner: w, who: loser.id, name: ex ? ex.name : 'Execution' });
          this.phaseT = Math.min(this.phaseT, 150);
        }
      }
      if (this.phaseT <= 0) {
        if (!this.executed) this.emit({ t: 'spared', winner: w, who: this.other(w).id });
        this.phase = 'matchEnd';
        this.matchOver = true;
        this.winner = w;
        this.winReason = this.roundReason;
        this.emit({ t: 'matchEnd', winner: this.winner, reason: this.winReason, executed: this.executed });
      }
      return;
    }
  }

  enterFinish() {
    this.phase = 'finish';
    this.phaseT = 480; // the 8-second window (GDD §8.1)
    this.executed = false;
    const w = this.roundWinner;
    const wf = this.fighters[w];
    // CPU winners decide deterministically up front: ~70% feed the Rift
    this.finishCpu = wf.ai ? (this.rng.chance(700) ? 60 + this.rng.int(200) : -1) : -2;
    if (wf.y <= 0 && wf.state !== 'kd') this.setState(wf, 'idle', 0);
    const loser = this.other(w);
    if (loser.y <= 0 && loser.state !== 'kd' && loser.state !== 'launched') this.setState(loser, 'kd', 99999);
    this.emit({ t: 'finishPrompt', winner: w });
  }

  resetRound() {
    this.roundNum++;
    this.timer = this.balance.rounds.timerSec;
    this.phase = 'intro';
    this.phaseT = 60;
    this.hitstopT = 0;
    this.superFlashT = 0;
    this.projectiles = [];
    const a = this.arena;
    const [f0, f1] = this.fighters;
    for (const [f, sx, fc] of [[f0, a.spawn.p1, 1], [f1, a.spawn.p2, -1]]) {
      f.x = sx * SCALE; f.y = 0; f.vx = 0; f.vy = 0; f.facing = fc;
      f.hp = f.hpMax;
      this.setState(f, 'idle', 0);
      f.stunT = 0; f.invulnT = 0; f.pushVx = 0; f.pushVxSelf = 0;
      f.bleedRegions = []; f.bleedAcc = 0; f.burnT = 0;   // Bleeding cleanses at round end (GDD §5.3)
      f.comboHits = 0; f.comboDmg = 0;
      f.flaresRound = 0;
      f.stancePhase = null;
      // meter, trauma, debt, graftHp all PERSIST (DECISIONS D-009)
    }
    this.emit({ t: 'round', n: this.roundNum });
  }

  // ---------------- effect DSL (P1 slice — match-scoped rules only)

  applyRules(f, trigger, ctx) {
    const hook = f.char.character.rpg_hook;
    if (!hook || !hook.effects) return;
    for (const r of hook.effects) {
      if (r.trigger !== trigger) continue;
      if (r.condition && !this.evalCond(r.condition, ctx)) continue;
      if (r.action === 'adjust_state' && r.target === 'debt') {
        f.debt = Math.max(0, f.debt + (r.delta || 0));
        this.emit({ t: 'debtShed', who: f.id, debt: f.debt });
      }
      // other actions are P4 (persistent) — deliberately inert here
    }
  }

  evalCond(cond, ctx) {
    // tiny evaluator: "<name> == <int>" | "<name> >= <int>" over ctx
    const m = /^(\w+)\s*(==|>=|<=|>|<)\s*(-?\d+)$/.exec(cond.trim());
    if (!m) return false;
    const v = ctx[m[1]];
    if (v === undefined) return false;
    const n = parseInt(m[3], 10);
    switch (m[2]) {
      case '==': return v === n;
      case '>=': return v >= n;
      case '<=': return v <= n;
      case '>': return v > n;
      case '<': return v < n;
    }
    return false;
  }

  // ---------------- serialize / hash

  serialize() {
    return {
      f: this.frame, ph: this.phase, pt: this.phaseT, rn: this.roundNum,
      rw: this.roundWins.slice(), tm: this.timer,
      hs: this.hitstopT, sf: this.superFlashT,
      wn: this.winner, wr: this.winReason, mo: this.matchOver,
      ex: !!this.executed, fr2: !!this.finalRound, fc: this.finishCpu === undefined ? null : this.finishCpu,
      rng: this.rng.state,
      fighters: this.fighters.map(f => f.serialize()),
      projectiles: this.projectiles.map(p => ({
        id: p.id, o: p.owner, m: p.moveId, x: p.x, y: p.y, vx: p.vx,
        l: p.life, a: p.age, d: p.durability, pi: p.pierce, h: p.hitIds.slice()
      })),
      pools: this.pools.map(p => ({ x: p.x, v: p.vol, r: p.r, k: p.drank || 0 })),
      trackers: this.trackers.map(t => t.serialize())
    };
  }

  hash() {
    const s = JSON.stringify(this.serialize());
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return h >>> 0;
  }
}

// ---------------------------------------------------------------- char bundle

// Build the runtime character bundle from raw JSON (browser fetches, node reads fs —
// the engine itself never loads files).
export function makeCharBundle(characterJson, movesJson, sundersJson, finishersJson) {
  const movesById = {};
  for (const m of movesJson) movesById[m.id] = m;
  const chainsFrom = {};
  for (const m of movesJson) {
    if (m.trigger && m.trigger.type === 'chain') {
      (chainsFrom[m.trigger.from] = chainsFrom[m.trigger.from] || []).push(m);
    }
  }
  return {
    character: characterJson, moves: movesJson, movesById, chainsFrom,
    sunders: sundersJson ? sundersJson.sunders : null,
    finishers: finishersJson || null
  };
}
