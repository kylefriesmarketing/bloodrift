// BLOODRIFT boot + game loop. Fixed 60Hz accumulator over the deterministic sim;
// everything here is host/view code — the sim never sees the DOM.

import { Sim, makeCharBundle, SCALE } from './engine/sim/sim.mjs';
import { B } from './engine/sim/input.mjs';
import { Renderer } from './engine/fx/render.mjs';
import { Hud } from './engine/ui/hud.mjs';
import { Sfx } from './engine/fx/sfx.mjs';
import {
  PROFILE_KEY, freshProfile, charProf, levelOf, masteryRank,
  buildMods, hydrateBundle, matchDelta, applyDelta
} from './engine/rpg/profile.mjs';

const $ = id => document.getElementById(id);

// ---------------- data
async function j(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + ' → ' + r.status); return r.json(); }

export const CHARS = ['zenith', 'graft', 'strigoi'];
const DATA = {};
async function loadData() {
  await Promise.all(CHARS.map(async id => {
    const [c, m, s, f] = await Promise.all([
      j(`data/characters/${id}/character.json`), j(`data/characters/${id}/moves.json`),
      j(`data/characters/${id}/sunders.json`), j(`data/characters/${id}/finishers.json`)
    ]);
    DATA[id] = { c, m, s, f };
  }));
  DATA.arena = await j('data/arenas/riftscar.json');
  DATA.balance = await j('data/balance/core.json');
}
// ---------------- profile (P4 v1 — Riftborn hydration, Tempered strips it)
let profile = freshProfile();
let tempered = false;
try {
  const raw = localStorage.getItem(PROFILE_KEY);
  if (raw) profile = JSON.parse(raw);
  tempered = localStorage.getItem('br-tempered') === '1';
} catch { /* fresh profile */ }
function saveProfile() {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    localStorage.setItem('br-tempered', tempered ? '1' : '0');
  } catch { /* storage unavailable — session-only */ }
}

function bundleOf(id) {
  const d = DATA[id];
  return hydrateBundle(d.c, d.m, d.s, d.f, buildMods(profile, id, tempered));
}
function sigOf(id) {
  const mods = buildMods(profile, id, tempered);
  return mods ? mods.sig : null;
}

// ---------------- input
// P1: WASD + T/Y (FP/BP) G/H (FK/BK) R throw F block V rift
// P2: arrows + I/O K/L U throw J block N rift
const KEYMAP = [
  { a: B.L, d: B.R, w: B.U, s: B.D, t: B.FP, y: B.BP, g: B.FK, h: B.BK, r: B.TH, f: B.BL, v: B.RF },
  {
    arrowleft: B.L, arrowright: B.R, arrowup: B.U, arrowdown: B.D,
    i: B.FP, o: B.BP, k: B.FK, l: B.BK, u: B.TH, j: B.BL, n: B.RF
  }
];
const keys = new Set();
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  sfx.ensure();
  if (k === 'enter') onEnter();
  if (k === 'escape') onEscape();
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

function maskOf(seat) {
  let m = 0;
  for (const [k, bit] of Object.entries(KEYMAP[seat])) if (keys.has(k)) m |= bit;
  return m;
}

// ---------------- match lifecycle (clean re-init, no reloads)
let sim = null, ren = null, hud = new Hud(), sfx = new Sfx();
let mode = null;            // '2p' | 'cpu' | 'watch'
let cpuLevel = 2;
const sel = { p1: 'zenith', p2: 'graft' };
let paused = false;
let slowmo = 0;
let acc = 0, lastT = 0;
const evRing = [];

function newMatch(seed) {
  sim = new Sim({
    chars: [bundleOf(sel.p1), bundleOf(sel.p2)],
    arena: DATA.arena,
    balance: DATA.balance,
    seed: seed || ((Date.now() % 0x7fffffff) | 1),
    sig: [sigOf(sel.p1), sigOf(sel.p2)],
    cpu: mode === 'watch' ? [{ level: cpuLevel }, { level: cpuLevel }]
      : mode === 'cpu' ? [null, { level: cpuLevel }]
        : null
  });
  sim._recorded = false;
  ren.reset();
  hud.reset();
  slowmo = 0;
  acc = 0;
  evRing.length = 0;
  paused = false;
}

function recordMatch() {
  if (!sim || sim._recorded || !sim.matchOver || tempered) return;
  sim._recorded = true;
  applyDelta(profile, sel.p1, matchDelta(sim, 0));
  applyDelta(profile, sel.p2, matchDelta(sim, 1));
  saveProfile();
  renderPickers();
}

function stepOnce() {
  const m0 = (mode === '2p' || mode === 'cpu') ? maskOf(0) : 0;
  const m1 = mode === '2p' ? maskOf(1) : 0;
  sim.step(m0, m1);
  afterStep();
  if (sim.ev.length) sfx.consume(sim.ev);
}

// shared post-step event processing — the ONLY place match results are recorded
function afterStep() {
  if (!sim.ev.length) return;
  for (const e of sim.ev) {
    evRing.push({ ...e, frame: sim.frame });
    if (e.t === 'roundEnd') slowmo = 70;
    if (e.t === 'matchEnd') recordMatch();
  }
  if (evRing.length > 400) evRing.splice(0, evRing.length - 400);
  ren.consume(sim, sim.ev);
  hud.consume(sim, sim.ev);
}

function frame(tNow) {
  requestAnimationFrame(frame);
  if (!sim || paused) { lastT = tNow; return; }
  if (!lastT) lastT = tNow;
  let dt = Math.min(100, tNow - lastT);
  lastT = tNow;
  const stepMs = slowmo > 0 ? 1000 / 30 : 1000 / 60;
  acc += dt;
  let guard = 0;
  while (acc >= stepMs && guard < 4) {
    acc -= stepMs;
    guard++;
    stepOnce();
    if (slowmo > 0) slowmo--;
  }
  ren.draw(sim);
  hud.draw(ren.cx, sim);
  if (sim.matchOver) {
    const cx = ren.cx;
    cx.textAlign = 'center';
    cx.font = '600 20px Georgia, serif';
    cx.fillStyle = '#e8dcc8';
    cx.strokeStyle = 'rgba(0,0,0,0.8)';
    cx.lineWidth = 4;
    cx.strokeText('ENTER — rematch      ESC — menu', 640, 470);
    cx.fillText('ENTER — rematch      ESC — menu', 640, 470);
  }
}

// hidden-tab fallback: keep the sim honest when rAF is throttled
setInterval(() => {
  if (!sim || paused || !document.hidden) return;
  for (let k = 0; k < 3; k++) stepOnce();
}, 50);

// ---------------- menu wiring
function onEnter() {
  if (!sim) return;
  if (sim.matchOver) newMatch();
}
function onEscape() {
  if (!sim) return;
  if (sim.matchOver) { toMenu(); return; }
  paused = !paused;
  $('pause').style.display = paused ? 'flex' : 'none';
}

function toMenu() {
  sim = null;
  $('menu').style.display = 'flex';
  $('stage').style.display = 'none';
  $('pause').style.display = 'none';
}

function startMode(m) {
  mode = m;
  $('menu').style.display = 'none';
  $('stage').style.display = 'block';
  newMatch();
}

function renderPickers() {
  for (const seat of ['p1', 'p2']) {
    const holder = $(`pick-${seat}`);
    holder.innerHTML = '';
    for (const id of CHARS) {
      const b = document.createElement('button');
      const cp = charProf(profile, id);
      b.textContent = tempered ? DATA[id].c.name : `${DATA[id].c.name} · LV${levelOf(cp.xp)}`;
      b.title = `${DATA[id].c.title} — ${cp.wins}W/${cp.matches - cp.wins}L · ${cp.executions} fed to the Rift`;
      b.classList.toggle('sel', sel[seat] === id);
      b.onclick = () => { sel[seat] = id; renderPickers(); };
      holder.appendChild(b);
    }
  }
  // ruleset + carried-state line
  const tb = $('m-tempered');
  if (tb) tb.textContent = tempered ? '⚖ TEMPERED — normalized, nothing carries' : '🩸 RIFTBORN — your scars come with you';
  const line = $('prof-line');
  if (line) {
    if (tempered) { line.textContent = 'ranked-legal ruleset · profiles untouched'; }
    else {
      const bits = [];
      const z = charProf(profile, 'zenith');
      if (z.sig.debt) bits.push(`ZENITH carries ${z.sig.debt} Solar Debt (−${Math.min(z.sig.debt, 15)}% max HP)`);
      const s = charProf(profile, 'strigoi');
      if (s.sig.bank) {
        const bk = s.sig.bank;
        bits.push(`STRIGOI's cellar: ${bk.vanguard || 0} hero · ${bk.court || 0} court · ${bk.dominion || 0} dominion vintages`);
      }
      const mastered = [];
      for (const id of CHARS) {
        const cp = charProf(profile, id);
        for (const [mvId, m] of Object.entries(cp.mastery)) {
          const r = masteryRank(m);
          if (r === 'B' || r === 'A' || r === 'S') mastered.push(`${mvId} ${r}`);
        }
      }
      if (mastered.length) bits.push(`mastered: ${mastered.slice(0, 4).join(', ')}`);
      line.textContent = bits.length ? bits.join('   ·   ') : 'a fresh book — the Rift has no record of you yet';
    }
  }
}

async function boot() {
  await loadData();
  ren = new Renderer($('cv'), DATA.arena);
  renderPickers();
  $('m-cpu').onclick = () => startMode('cpu');
  $('m-2p').onclick = () => startMode('2p');
  $('m-watch').onclick = () => startMode('watch');
  $('m-tempered').onclick = () => { tempered = !tempered; saveProfile(); renderPickers(); };
  document.querySelectorAll('[data-lvl]').forEach(b => {
    b.onclick = () => {
      cpuLevel = +b.dataset.lvl;
      document.querySelectorAll('[data-lvl]').forEach(x => x.classList.toggle('sel', x === b));
    };
  });
  $('loading').style.display = 'none';
  $('menu-inner').style.display = 'block';
  requestAnimationFrame(frame);

  // test hooks (headless-friendly: drive the sim without rAF)
  window.__br = {
    get sim() { return sim; },
    get profile() { return profile; },
    get tempered() { return tempered; },
    setTempered(v) { tempered = !!v; saveProfile(); renderPickers(); return tempered; },
    wipeProfile() { profile = freshProfile(); saveProfile(); renderPickers(); return true; },
    data: DATA,
    chars: CHARS,
    start(m, opts = {}) {
      mode = m || 'watch';
      cpuLevel = opts.level || 2;
      if (opts.p1) sel.p1 = opts.p1;
      if (opts.p2) sel.p2 = opts.p2;
      $('menu').style.display = 'none';
      $('stage').style.display = 'block';
      newMatch(opts.seed);
      return true;
    },
    step(n = 1, m0 = 0, m1 = 0) {
      for (let k = 0; k < n; k++) stepOnce0(m0, m1);
      return sim.frame;
    },
    state() {
      if (!sim) return null;
      const [a, b] = sim.fighters;
      return {
        frame: sim.frame, phase: sim.phase, round: sim.roundNum, wins: sim.roundWins.slice(),
        timer: sim.timer, over: sim.matchOver, winner: sim.winner, reason: sim.winReason,
        chars: [a.char.character.id, b.char.character.id],
        hp: [a.hp, b.hp], meter: [a.meter, b.meter],
        debt: [a.debt, b.debt], graftHp: [a.graftHp, b.graftHp],
        drinks: [a.facts.drinks, b.facts.drinks], sundered: [a.sundered, b.sundered],
        pools: sim.pools.length, x: [a.x / SCALE, b.x / SCALE], states: [a.state, b.state]
      };
    },
    hash() { return sim ? sim.hash() : 0; },
    evs: evRing,
    draw() { if (sim) { ren.draw(sim); hud.draw(ren.cx, sim); } return true; }
  };
  function stepOnce0(m0, m1) {
    sim.step(m0, m1);
    afterStep();
  }
}

boot().catch(e => {
  const el = $('loading');
  if (el) el.textContent = 'BOOT FAILED: ' + e.message;
  console.error(e);
});
