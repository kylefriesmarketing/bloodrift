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
import { buildMoveList } from './engine/ui/movelist.mjs';
import { introFor, buildCodex } from './engine/ui/story.mjs';

const $ = id => document.getElementById(id);

// Build stamp — shown on the menu. GitHub Pages caches assets for ~10 minutes, so a
// stale tab will display an OLD number here: that's the tell to hard-refresh, rather
// than wondering why a change "didn't deploy".
export const BUILD = '2026-08-05.6';

// ---------------- data
async function j(u) {
  const r = await fetch(u + (u.includes('?') ? '&' : '?') + 'v=' + BUILD);
  if (!r.ok) throw new Error(u + ' → ' + r.status);
  return r.json();
}

export const CHARS = [
  'zenith', 'triage', 'centurion', 'joule', 'marrow',            // THE VANGUARD — heroes
  'sovereign', 'terminus', 'halflight', 'chorus', 'kestrel',     // THE APEX — villains
  'strigoi', 'lycaon', 'graft', 'khet', 'harrow',                // THE MIDNIGHT COURT — monsters
  'flux', 'vespra', 'ordnance', 'null', 'vyrm'                   // THE SPIRAL DOMINION — aliens
];

// four powers, four mutually exclusive win conditions, one hungry referee
export const FACTIONS = {
  vanguard: { name: 'THE VANGUARD', kind: 'HEROES', col: '#c9a227',
    line: 'What is left of Earth\'s heroes. They buried most of their own the day the Rift opened.',
    wants: 'wants the Rift CLOSED, whatever it costs them' },
  apex: { name: 'THE APEX', kind: 'VILLAINS', col: '#d4af37',
    line: 'The people who beat the Vanguard. On Convergence morning they had already won — then reality interrupted.',
    wants: 'wants the Rift to PAY OUT — to give back the world they had taken' },
  court: { name: 'THE MIDNIGHT COURT', kind: 'MONSTERS', col: '#b03040',
    line: 'The old predators of the hidden realm, delighted that the walls are down.',
    wants: 'wants the Rift OPEN forever — it runs on blood, and so do they' },
  dominion: { name: 'THE SPIRAL DOMINION', kind: 'ALIENS', col: '#3ec6b8',
    line: 'An invading armada severed from its empire — castaways with a fleet\'s worth of grudge.',
    wants: 'wants the Rift REOPENED — a way home, or a throne here' }
};
const FACTION_ORDER = ['vanguard', 'apex', 'court', 'dominion'];
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
  DATA.looks = await j('data/looks.json');
  DATA.story = await j('data/story.json');
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
  if ($('codex').style.display === 'block') {
    if (k === 'escape' || k === 'enter') hideCodex();
    return;
  }
  if ($('movelist').style.display === 'block') {
    if (k === 'escape' || k === 'enter') hideMoveList();
    return;
  }
  if (k === 'c') { showCodex(); return; }
  if (morgueKey(k)) return;
  if (k === 'm' && sim) { showMoveList(); return; }
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

// ---------------- THE MORGUE (training)
const DUMMY = [
  { id: 'stand', label: 'STAND', mask: () => 0 },
  { id: 'block', label: 'BLOCK ALL', mask: () => B.BL },
  { id: 'crouch', label: 'CROUCH-BLOCK', mask: () => B.BL | B.D },
  { id: 'crouch0', label: 'CROUCH', mask: () => B.D },
  { id: 'jump', label: 'JUMP', mask: t => (t % 90 < 6 ? B.U : 0) },
  { id: 'cpu', label: 'CPU (rift-fed)', mask: () => 0 }
];
const training = {
  dummy: 0, infMeter: true, boxes: false, autoHeal: true,
  adv: null, advKind: '', maxCombo: 0, maxDmg: 0, t: 0
};

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
  const morgueCpu = mode === 'morgue' && DUMMY[training.dummy].id === 'cpu';
  sim = new Sim({
    chars: [bundleOf(sel.p1), bundleOf(sel.p2)],
    arena: DATA.arena,
    balance: DATA.balance,
    seed: seed || ((Date.now() % 0x7fffffff) | 1),
    sig: [sigOf(sel.p1), sigOf(sel.p2)],
    cpu: mode === 'watch' ? [{ level: cpuLevel }, { level: cpuLevel }]
      : mode === 'cpu' ? [null, { level: cpuLevel }]
        : morgueCpu ? [null, { level: 3 }]
          : null
  });
  resetView();
  showIntro();
  if (mode === 'morgue') {
    training.adv = null; training.maxCombo = 0; training.maxDmg = 0; training.t = 0;
    ren.debugBoxes = training.boxes;
    renderMorgueHud();
  }
}

function morgueKey(k) {
  if (mode !== 'morgue' || !sim) return false;
  if (k === '1') { training.dummy = (training.dummy + 1) % DUMMY.length; newMatch(); return true; }
  if (k === '2') { training.infMeter = !training.infMeter; if (!training.infMeter) sim.fighters[0].meter = 0; renderMorgueHud(); return true; }
  if (k === '3') { training.boxes = !training.boxes; ren.debugBoxes = training.boxes; renderMorgueHud(); return true; }
  if (k === '4') { training.autoHeal = !training.autoHeal; renderMorgueHud(); return true; }
  if (k === '5') { newMatch(); return true; }
  return false;
}

// ---------------- story
function showIntro() {
  const bar = $('intro-bar');
  if (!bar || mode === 'morgue') return;
  const ex = introFor(DATA.story, sel.p1, sel.p2, DATA[sel.p1].c, DATA[sel.p2].c);
  const side = (who, align) => {
    const ch = DATA[who.id].c;
    const col = FACTIONS[ch.faction].col;
    return `<div class="ib-line" style="text-align:${align}">
      <span class="ib-who" style="color:${col}">${ch.name}</span> &nbsp;<i>“${who.line}”</i></div>`;
  };
  bar.innerHTML = side(ex.a, 'left') + side(ex.b, 'right');
  bar.style.display = 'block';
  bar.style.opacity = '1';
  clearTimeout(showIntro._t1); clearTimeout(showIntro._t2);
  showIntro._t1 = setTimeout(() => { bar.style.transition = 'opacity 0.7s'; bar.style.opacity = '0'; }, 2600);
  showIntro._t2 = setTimeout(() => { bar.style.display = 'none'; bar.style.transition = ''; }, 3400);
}

function showCodex() {
  $('cx-body').innerHTML = buildCodex(DATA.story, FACTIONS, CHARS, DATA);
  $('codex').style.display = 'block';
  $('codex').scrollTop = 0;
}
function hideCodex() { $('codex').style.display = 'none'; }

// ---------------- command list
function showMoveList() {
  $('ml-body').innerHTML = buildMoveList(bundleOf(sel.p1), 0);
  $('movelist').style.display = 'block';
  $('movelist').scrollTop = 0;
}
function hideMoveList() { $('movelist').style.display = 'none'; }

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

// ov0/ov1 let the test hooks drive the exact same path the game loop uses
function stepOnce(ov0, ov1) {
  const m0 = ov0 !== undefined ? ov0
    : (mode === '2p' || mode === 'cpu' || mode === 'morgue') ? maskOf(0) : 0;
  let m1 = ov1 !== undefined ? ov1 : mode === '2p' ? maskOf(1) : 0;
  if (mode === 'morgue') {
    training.t++;
    if (ov1 === undefined) m1 = DUMMY[training.dummy].mask(training.t);
    if (training.infMeter) sim.fighters[0].meter = sim.balance.meter.max;
    if (training.autoHeal && sim.fighters[1].hp < sim.fighters[1].hpMax && sim.fighters[1].comboHits === 0
      && sim.fighters[1].state !== 'hitstun' && sim.fighters[1].state !== 'launched') {
      sim.fighters[1].hp = Math.min(sim.fighters[1].hpMax, sim.fighters[1].hp + 6);
      sim.fighters[0].hp = Math.min(sim.fighters[0].hpMax, sim.fighters[0].hp + 6);
    }
    sim.timer = sim.balance.rounds.timerSec; // the Morgue has no clock
  }
  sim.step(m0, m1);
  afterStep();
  sfx.consume(sim.ev, sim);
  if (mode === 'morgue') trainingTrack();
}

// live frame-advantage readout: at contact, compare how long each side stays busy
function trainingTrack() {
  for (const e of sim.ev) {
    if (e.t !== 'hit' && e.t !== 'block') continue;
    const atk = sim.fighters[e.t === 'hit' ? 1 - e.who : 1 - e.who];
    const vic = sim.fighters[e.who];
    let atkBusy = 0;
    if (atk.state === 'move' && atk.moveId) {
      const mv = atk.char.movesById[atk.moveId];
      if (mv && mv.frames) atkBusy = (mv.frames.startup + mv.frames.active + mv.frames.recovery) - atk.moveF;
    }
    const vicBusy = vic.stunT || 0;
    training.adv = vicBusy - atkBusy;
    training.advKind = e.t === 'hit' ? 'on hit' : 'on block';
  }
  const d = sim.fighters[1];
  if (d.comboHits > training.maxCombo) { training.maxCombo = d.comboHits; training.maxDmg = d.comboDmg; }
  else if (d.comboHits === training.maxCombo && d.comboDmg > training.maxDmg) training.maxDmg = d.comboDmg;
  renderMorgueHud();
}

function renderMorgueHud() {
  const el = $('morgue-hud');
  if (!el) return;
  const f = sim.fighters[0], d = sim.fighters[1];
  let mvLine = '—';
  if (f.state === 'move' && f.moveId) {
    const mv = f.char.movesById[f.moveId];
    if (mv && mv.frames) {
      const { startup, active, recovery } = mv.frames;
      const phase = f.moveF <= startup ? 'startup' : f.moveF <= startup + active ? 'ACTIVE' : 'recovery';
      mvLine = `<b>${mv.name}</b> ${startup}/${active}/${recovery} — frame ${f.moveF} (${phase})`;
    }
  } else mvLine = `<b>${f.state}</b>`;
  const advTxt = training.adv === null ? '—'
    : `<span style="color:${training.adv >= 0 ? '#6fd88a' : '#e8646e'}">${training.adv >= 0 ? '+' : ''}${training.adv}</span> ${training.advKind}`;
  el.innerHTML =
    `${mvLine}<br>` +
    `advantage <span class="mg-adv">${advTxt}</span> &nbsp;·&nbsp; combo <b>${d.comboHits}</b> (${d.comboDmg}) &nbsp;·&nbsp; best <b>${training.maxCombo}</b> (${training.maxDmg})<br>` +
    `dummy <b>${DUMMY[training.dummy].label}</b> &nbsp;·&nbsp; meter ${training.infMeter ? '<b>∞</b>' : 'normal'} &nbsp;·&nbsp; boxes ${training.boxes ? '<b>on</b>' : 'off'}<br>` +
    `<span class="mg-keys">1 dummy · 2 meter · 3 hitboxes · 4 heal · 5 reset · ESC menu</span>`;
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
  if (mode === 'morgue') { toMenu(); return; }
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
  mode = null;
  $('menu').style.display = 'flex';
  $('stage').style.display = 'none';
  $('pause').style.display = 'none';
  $('gauntlet').style.display = 'none';
  $('morgue-hud').style.display = 'none';
  if (ren) ren.debugBoxes = false;
  renderPickers();
}

function startMode(m) {
  mode = m;
  $('menu').style.display = 'none';
  $('stage').style.display = 'block';
  $('morgue-hud').style.display = m === 'morgue' ? 'block' : 'none';
  newMatch();
}

function renderPickers() {
  for (const seat of ['p1', 'p2']) {
    const holder = $(`pick-${seat}`);
    holder.innerHTML = '';
    for (const fk of FACTION_ORDER) {
      const fac = FACTIONS[fk];
      const members = CHARS.filter(id => DATA[id].c.faction === fk);
      if (!members.length) continue;
      const grp = document.createElement('span');
      grp.className = 'fac-grp';
      const lbl = document.createElement('span');
      lbl.className = 'fac-lbl';
      lbl.style.color = fac.col;
      lbl.textContent = fac.kind;
      lbl.title = `${fac.name} — ${fac.line}`;
      grp.appendChild(lbl);
      for (const id of members) {
        const b = document.createElement('button');
        const cp = charProf(profile, id);
        const ch = DATA[id].c;
        b.textContent = tempered ? ch.name : `${ch.name} · LV${levelOf(cp.xp)}`;
        b.title = `${ch.title}\n${ch.archetype} · difficulty ${'★'.repeat(ch.difficulty || 1)}\n${cp.wins}W/${cp.matches - cp.wins}L · ${cp.executions} fed to the Rift`;
        b.style.borderColor = sel[seat] === id ? fac.col : '';
        b.classList.toggle('sel', sel[seat] === id);
        b.onclick = () => { sel[seat] = id; renderPickers(); };
        grp.appendChild(b);
      }
      holder.appendChild(grp);
    }
  }
  // who you picked, and why they are here
  for (const seat of ['p1', 'p2']) {
    const el = $(`who-${seat}`);
    if (!el) continue;
    const ch = DATA[sel[seat]].c;
    const fac = FACTIONS[ch.faction];
    el.innerHTML = `<b style="color:${fac.col}">${ch.name}</b> <i>${ch.title}</i> — ${ch.archetype}
      ${'★'.repeat(ch.difficulty || 1)}<span style="opacity:.35">${'★'.repeat(5 - (ch.difficulty || 1))}</span>
      <span style="color:${fac.col};opacity:.8"> · ${fac.name}</span>`;
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
  ren = new Renderer($('cv'), DATA.arena, DATA.looks);
  renderPickers();
  $('m-cpu').onclick = () => startMode('cpu');
  $('m-2p').onclick = () => startMode('2p');
  $('m-watch').onclick = () => startMode('watch');
  $('m-morgue').onclick = () => startMode('morgue');
  $('m-moves').onclick = showMoveList;
  $('ml-close').onclick = hideMoveList;
  $('m-codex').onclick = showCodex;
  $('cx-close').onclick = hideCodex;
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
  const stamp = $('buildstamp');
  if (stamp) stamp.textContent = 'build ' + BUILD;
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
    step(n = 1, m0 = 0, m1) {
      for (let k = 0; k < n; k++) stepOnce(m0, m1);
      return sim.frame;
    },
    training,
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
}

boot().catch(e => {
  const el = $('loading');
  if (el) el.textContent = 'BOOT FAILED: ' + e.message;
  console.error(e);
});
