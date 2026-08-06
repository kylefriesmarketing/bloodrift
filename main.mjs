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
import {
  FLOORS, weeklySeed, makeRun, makeRunState, boonOffer, boonsToMods,
  fightSetup, advance, recordRun
} from './engine/rpg/gauntlet.mjs';

const $ = id => document.getElementById(id);

// ---------------- data
async function j(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + ' → ' + r.status); return r.json(); }

export const CHARS = ['zenith', 'triage', 'centurion', 'joule', 'marrow',
  'strigoi', 'lycaon', 'graft', 'khet', 'harrow',
  'flux', 'vespra', 'ordnance', 'null', 'vyrm'];
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
  DATA.gmut = await j('data/gauntlet/mutators.json');
  DATA.gboon = await j('data/gauntlet/boons.json');
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

function resetView() {
  sim._recorded = false;
  ren.reset();
  hud.reset();
  slowmo = 0;
  acc = 0;
  evRing.length = 0;
  paused = false;
}

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
  resetView();
}

// ---------------- THE GAUNTLET (P6, D-017)
let gauntlet = null; // { run, state } (+ state._pendingBoon)
const GKEY = 'br-gauntlet-run';

function saveGauntlet() {
  try {
    if (gauntlet) localStorage.setItem(GKEY, JSON.stringify({ run: gauntlet.run, state: gauntlet.state }));
    else localStorage.removeItem(GKEY);
  } catch { /* session-only */ }
}

function startGauntlet() {
  gauntlet = { run: makeRun(weeklySeed(), sel.p1, CHARS, DATA.gmut.mutators), state: makeRunState() };
  saveGauntlet();
  showTower();
}

function showTower() {
  $('menu').style.display = 'none';
  $('stage').style.display = 'none';
  $('pause').style.display = 'none';
  $('gauntlet').style.display = 'flex';
  renderTower();
}

function renderTower() {
  const g = gauntlet;
  const st = g.state;
  const player = DATA[g.run.player].c.name;
  $('g-sub').textContent = `${player} climbs the weekly tower · seed ${g.run.seed.toString(16)} · best floor ${charProf(profile, g.run.player).gauntlet ? charProf(profile, g.run.player).gauntlet.bestFloor : 0}`;

  // ladder (rendered bottom-up by column-reverse)
  const fl = $('g-floors');
  fl.innerHTML = '';
  const byId = Object.fromEntries(DATA.gmut.mutators.map(m => [m.id, m]));
  for (const f of g.run.floors) {
    const row = document.createElement('div');
    row.className = 'g-floor' + (f.floor === st.floor && !st.done ? ' cur' : '') + (f.floor < st.floor || (st.done && st.cleared) ? ' won' : '');
    const revealed = f.floor <= st.floor;
    const mut = f.mutatorId && revealed ? (byId[f.mutatorId] ? byId[f.mutatorId].name : f.mutatorId) : (f.mutatorId ? '?' : 'a clean fight');
    row.innerHTML = `<span>FLOOR ${f.floor} — <b>${DATA[f.opp].c.name}</b> <span style="opacity:.6">(${['', 'timid', 'hungry', 'rift-fed'][f.cpuLevel]})</span></span><span class="g-mut">${mut}</span>`;
    fl.appendChild(row);
  }

  // active mutators + owned boons
  const setup = st.done ? null : fightSetup(g.run, st, DATA.gmut.mutators);
  const boonNames = st.boons.map(id => (DATA.gboon.boons.find(b => b.id === id) || { name: id }).name);
  $('g-boons').innerHTML =
    (setup && setup.activeMutators.length ? `<div style="color:#d88a92">active: ${setup.activeMutators.map(m => `${m.name} — ${m.desc}`).join('  ·  ')}</div>` : '') +
    (boonNames.length ? `<div>your boons: ${boonNames.join(' · ')}</div>` : '<div style="opacity:.6">no boons yet — win a floor, draft one</div>');

  // draft
  const draft = $('g-draft');
  draft.innerHTML = '';
  if (st._pendingBoon && !st.done) {
    const offer = boonOffer(g.run, st, DATA.gboon.boons);
    draft.style.display = 'flex';
    for (const b of offer) {
      const card = document.createElement('button');
      card.className = 'g-card';
      card.innerHTML = `<b>${b.name}</b><span>${b.desc}</span>`;
      card.onclick = () => {
        st.boons.push(b.id);
        st._pendingBoon = false;
        saveGauntlet();
        renderTower();
      };
      draft.appendChild(card);
    }
  } else draft.style.display = 'none';

  // result / actions
  const res = $('g-result');
  if (st.done) {
    res.style.display = 'block';
    res.style.color = st.cleared ? '#ffcf6a' : '#ff2135';
    res.textContent = st.cleared ? '🗼 THE TOWER IS CLEARED — the Rift is impressed' : `FELL ON FLOOR ${st.floor} — best: ${st.bestFloor}`;
    $('g-fight').style.display = 'none';
    $('g-abandon').textContent = '↩ RETURN';
  } else {
    res.style.display = 'none';
    $('g-fight').style.display = st._pendingBoon ? 'none' : '';
    $('g-fight').textContent = `⚔ FIGHT FLOOR ${st.floor} — ${DATA[g.run.floors[st.floor - 1].opp].c.name}`;
    $('g-abandon').textContent = '✖ abandon the run';
  }
}

function fightFloor() {
  const g = gauntlet;
  if (!g || g.state.done || g.state._pendingBoon) return;
  const setup = fightSetup(g.run, g.state, DATA.gmut.mutators);
  const bm = boonsToMods(g.state.boons, DATA.gboon.boons);
  mode = 'cpu';
  sel.p2 = setup.opp; // recordMatch + HUD read the real pairing
  let pb = bundleOf(sel.p1);
  if (bm.hpPermille !== 1000) {
    const c2 = { ...pb.character, stats: { ...pb.character.stats, hp: Math.trunc(pb.character.stats.hp * bm.hpPermille / 1000) } };
    pb = makeCharBundle(c2, pb.moves, DATA[sel.p1].s, DATA[sel.p1].f);
  }
  const balance = JSON.parse(JSON.stringify(DATA.balance));
  if (setup.balancePatch.timerSec) balance.rounds.timerSec = setup.balancePatch.timerSec;
  if (setup.balancePatch.toWin) balance.rounds.toWin = setup.balancePatch.toWin;
  sim = new Sim({
    chars: [pb, bundleOf(setup.opp)],
    arena: DATA.arena,
    balance,
    seed: setup.seed,
    sig: [sigOf(sel.p1), sigOf(setup.opp)],
    cpu: [null, { level: setup.cpuLevel }],
    tuning: setup.tuning,
    seatMods: [bm.seatMods, null]
  });
  resetView();
  sim._gauntlet = true;
  $('gauntlet').style.display = 'none';
  $('stage').style.display = 'block';
  hud.say(`FLOOR ${setup.floor}`, setup.activeMutators.map(m => m.name).join(' · ') || 'a clean fight', '#c9a227', 100);
}

function resolveGauntletFight() {
  const won = sim.winner === 0;
  advance(gauntlet.state, won);
  if (gauntlet.state.done) {
    recordRun(profile, gauntlet.run.player, gauntlet.state, charProf);
    saveProfile();
    gauntlet.state._pendingBoon = false;
    saveGauntlet();
    localStorage.removeItem(GKEY);
  } else if (won) {
    gauntlet.state._pendingBoon = true;
    saveGauntlet();
  }
  sim = null;
  renderPickers();
  showTower();
}

function endGauntlet() {
  if (gauntlet && !gauntlet.state.done && gauntlet.state.bestFloor > 0) {
    recordRun(profile, gauntlet.run.player, gauntlet.state, charProf);
    saveProfile();
  }
  gauntlet = null;
  saveGauntlet();
  renderPickers();
  toMenu();
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
    const line = sim._gauntlet ? 'ENTER — back to the tower' : 'ENTER — rematch      ESC — menu';
    cx.strokeText(line, 640, 470);
    cx.fillText(line, 640, 470);
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
  if (sim.matchOver) {
    if (sim._gauntlet) resolveGauntletFight();
    else newMatch();
  }
}
function onEscape() {
  if (!sim) {
    if ($('gauntlet').style.display === 'flex') toMenu(); // tower keeps its place
    return;
  }
  if (sim.matchOver) {
    if (sim._gauntlet) resolveGauntletFight();
    else toMenu();
    return;
  }
  paused = !paused;
  $('pause').style.display = paused ? 'flex' : 'none';
}

function toMenu() {
  sim = null;
  $('menu').style.display = 'flex';
  $('stage').style.display = 'none';
  $('pause').style.display = 'none';
  $('gauntlet').style.display = 'none';
  renderPickers();
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
  const gb = $('m-gauntlet');
  if (gb) {
    gb.textContent = (gauntlet && !gauntlet.state.done)
      ? `🗼 RESUME THE TOWER — floor ${gauntlet.state.floor} as ${DATA[gauntlet.run.player] ? DATA[gauntlet.run.player].c.name : gauntlet.run.player}`
      : '🗼 THE GAUNTLET — climb 7 floors';
  }
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
  // the tower
  try {
    const saved = localStorage.getItem(GKEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.run && parsed.state && !parsed.state.done) gauntlet = parsed;
      else localStorage.removeItem(GKEY);
    }
  } catch { /* fresh */ }
  $('m-gauntlet').onclick = () => {
    if (gauntlet && !gauntlet.state.done) showTower();
    else startGauntlet();
  };
  $('g-fight').onclick = fightFloor;
  $('g-back').onclick = toMenu;
  $('g-abandon').onclick = endGauntlet;
  renderPickers(); // refresh labels now that a saved tower may have loaded
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
    draw() { if (sim) { ren.draw(sim); hud.draw(ren.cx, sim); } return true; },
    // gauntlet test hooks
    get gauntlet() { return gauntlet; },
    gStart(p1) { if (p1) sel.p1 = p1; startGauntlet(); return gauntlet.run; },
    gFight() { fightFloor(); return !!(sim && sim._gauntlet); },
    gResolve() { resolveGauntletFight(); return { floor: gauntlet.state.floor, done: gauntlet.state.done, cleared: gauntlet.state.cleared, pending: !!gauntlet.state._pendingBoon }; },
    gPick(idx) {
      const offer = boonOffer(gauntlet.run, gauntlet.state, DATA.gboon.boons);
      const b = offer[idx || 0];
      gauntlet.state.boons.push(b.id);
      gauntlet.state._pendingBoon = false;
      saveGauntlet();
      renderTower();
      return b.id;
    },
    gEnd() { endGauntlet(); return true; }
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
