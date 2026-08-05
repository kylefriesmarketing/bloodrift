// BLOODRIFT boot + game loop. Fixed 60Hz accumulator over the deterministic sim;
// everything here is host/view code — the sim never sees the DOM.

import { Sim, makeCharBundle, SCALE } from './engine/sim/sim.mjs';
import { B } from './engine/sim/input.mjs';
import { Renderer } from './engine/fx/render.mjs';
import { Hud } from './engine/ui/hud.mjs';
import { Sfx } from './engine/fx/sfx.mjs';

const $ = id => document.getElementById(id);

// ---------------- data
async function j(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + ' → ' + r.status); return r.json(); }

const DATA = {};
async function loadData() {
  const [zc, zm, zs, zf, gc, gm, gs, gf, arena, balance] = await Promise.all([
    j('data/characters/zenith/character.json'), j('data/characters/zenith/moves.json'),
    j('data/characters/zenith/sunders.json'), j('data/characters/zenith/finishers.json'),
    j('data/characters/graft/character.json'), j('data/characters/graft/moves.json'),
    j('data/characters/graft/sunders.json'), j('data/characters/graft/finishers.json'),
    j('data/arenas/riftscar.json'), j('data/balance/core.json')
  ]);
  DATA.zenith = { c: zc, m: zm, s: zs, f: zf };
  DATA.graft = { c: gc, m: gm, s: gs, f: gf };
  DATA.arena = arena;
  DATA.balance = balance;
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
let humanSeat = 0;          // in cpu mode, which seat the human drives
let cpuLevel = 2;
let paused = false;
let slowmo = 0;
let acc = 0, lastT = 0;
const evRing = [];

function newMatch() {
  sim = new Sim({
    chars: [
      makeCharBundle(DATA.zenith.c, DATA.zenith.m, DATA.zenith.s, DATA.zenith.f),
      makeCharBundle(DATA.graft.c, DATA.graft.m, DATA.graft.s, DATA.graft.f)
    ],
    arena: DATA.arena,
    balance: DATA.balance,
    seed: (Date.now() % 0x7fffffff) | 1,
    cpu: mode === 'watch' ? [{ level: cpuLevel }, { level: cpuLevel }]
      : mode === 'cpu' ? (humanSeat === 0 ? [null, { level: cpuLevel }] : [{ level: cpuLevel }, null])
        : null
  });
  ren.reset();
  hud.reset();
  slowmo = 0;
  acc = 0;
  evRing.length = 0;
  paused = false;
}

function stepOnce() {
  const m0 = mode === '2p' ? maskOf(0) : (mode === 'cpu' && humanSeat === 0 ? maskOf(0) : 0);
  const m1 = mode === '2p' ? maskOf(1) : (mode === 'cpu' && humanSeat === 1 ? maskOf(1) : 0);
  sim.step(m0, m1);
  if (sim.ev.length) {
    for (const e of sim.ev) {
      evRing.push({ ...e, frame: sim.frame });
      if (e.t === 'roundEnd') slowmo = 70;
    }
    if (evRing.length > 400) evRing.splice(0, evRing.length - 400);
    ren.consume(sim, sim.ev);
    hud.consume(sim, sim.ev);
    sfx.consume(sim.ev);
  }
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

async function boot() {
  await loadData();
  ren = new Renderer($('cv'), DATA.arena);
  $('m-cpu').onclick = () => { humanSeat = 0; startMode('cpu'); };
  $('m-cpu-graft').onclick = () => { humanSeat = 1; startMode('cpu'); };
  $('m-2p').onclick = () => startMode('2p');
  $('m-watch').onclick = () => startMode('watch');
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
    data: DATA,
    start(m, opts = {}) {
      mode = m || 'watch';
      humanSeat = opts.humanSeat || 0;
      cpuLevel = opts.level || 2;
      $('menu').style.display = 'none';
      $('stage').style.display = 'block';
      newMatch();
      if (opts.seed) {
        sim = new Sim({
          chars: [makeCharBundle(DATA.zenith.c, DATA.zenith.m, DATA.zenith.s, DATA.zenith.f),
            makeCharBundle(DATA.graft.c, DATA.graft.m, DATA.graft.s, DATA.graft.f)],
          arena: DATA.arena, balance: DATA.balance, seed: opts.seed,
          cpu: mode === 'watch' ? [{ level: cpuLevel }, { level: cpuLevel }]
            : mode === 'cpu' ? (humanSeat === 0 ? [null, { level: cpuLevel }] : [{ level: cpuLevel }, null]) : null
        });
      }
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
        hp: [a.hp, b.hp], meter: [a.meter, b.meter], debt: a.debt, graftHp: b.graftHp,
        pools: sim.pools.length, x: [a.x / SCALE, b.x / SCALE], states: [a.state, b.state]
      };
    },
    hash() { return sim ? sim.hash() : 0; },
    evs: evRing,
    draw() { if (sim) { ren.draw(sim); hud.draw(ren.cx, sim); } return true; }
  };
  function stepOnce0(m0, m1) {
    sim.step(m0, m1);
    if (sim.ev.length) {
      for (const e of sim.ev) evRing.push({ ...e, frame: sim.frame });
      if (evRing.length > 400) evRing.splice(0, evRing.length - 400);
      ren.consume(sim, sim.ev);
      hud.consume(sim, sim.ev);
    }
  }
}

boot().catch(e => {
  const el = $('loading');
  if (el) el.textContent = 'BOOT FAILED: ' + e.message;
  console.error(e);
});
