// Headless test harness: loads data from disk, builds Sims, scripts inputs.
// The engine itself never touches files — the harness (or the browser) feeds it JSON.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { Sim, makeCharBundle } from '../engine/sim/sim.mjs';
import { B } from '../engine/sim/input.mjs';

export const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

export function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

const cache = {};
export function data(rel) {
  if (!cache[rel]) cache[rel] = loadJson(rel);
  return cache[rel];
}

export function makeSim(opts = {}) {
  const sim = new Sim({
    chars: [
      makeCharBundle(
        data('data/characters/zenith/character.json'), data('data/characters/zenith/moves.json'),
        data('data/characters/zenith/sunders.json'), data('data/characters/zenith/finishers.json')),
      makeCharBundle(
        data('data/characters/graft/character.json'), data('data/characters/graft/moves.json'),
        data('data/characters/graft/sunders.json'), data('data/characters/graft/finishers.json'))
    ],
    arena: data('data/arenas/riftscar.json'),
    balance: data('data/balance/core.json'),
    seed: opts.seed || 42,
    cpu: opts.cpu || null
  });
  if (opts.startMeter) {
    sim.fighters[0].meter = opts.startMeter[0] | 0;
    sim.fighters[1].meter = opts.startMeter[1] | 0;
  }
  return sim;
}

// ------------- input scripting

export function masks(n) { return [new Array(n).fill(0), new Array(n).fill(0)]; }

export function hold(arr, from, to, mask) {
  for (let f = from; f <= to && f < arr.length; f++) arr[f] |= mask;
}

export function press(arr, frame, mask) {
  if (frame < arr.length) arr[frame] |= mask;
}

// write a motion input ending in a button press; returns the button-press frame
export function motion(arr, frame, name, buttonBit, facing, extraHold = 0) {
  const fwd = facing > 0 ? B.R : B.L;
  const back = facing > 0 ? B.L : B.R;
  const dm = d => d === 2 ? B.D : d === 3 ? (B.D | fwd) : d === 1 ? (B.D | back) : d === 6 ? fwd : d === 4 ? back : 0;
  const seqs = { qcf: [2, 3, 6], qcb: [2, 1, 4], dp: [6, 2, 3], hcb: [6, 3, 2, 4], bf: [4, 5, 6] };
  const dirs = seqs[name];
  let f = frame;
  for (const d of dirs) {
    arr[f] |= dm(d) | extraHold; f++;
    arr[f] |= dm(d) | extraHold; f++;
  }
  arr[f] |= dm(dirs[dirs.length - 1]) | buttonBit | extraHold;
  return f;
}

// ------------- running

export function run(sim, m0, m1, n, collect) {
  const evs = [];
  for (let f = 0; f < n; f++) {
    sim.step(m0 ? (m0[f] || 0) : 0, m1 ? (m1[f] || 0) : 0);
    if (sim.ev.length) for (const e of sim.ev) evs.push({ ...e, frame: sim.frame });
    if (collect && collect(sim, f)) break;
  }
  return evs;
}

export function findEv(evs, type, pred) {
  return evs.find(e => e.t === type && (!pred || pred(e)));
}

export function countEv(evs, type) {
  return evs.filter(e => e.t === type).length;
}

// step until an event type fires; returns {frame, ev} or null
export function runUntil(sim, m0, m1, maxN, type) {
  for (let f = 0; f < maxN; f++) {
    sim.step(m0 ? (m0[f] || 0) : 0, m1 ? (m1[f] || 0) : 0);
    const e = sim.ev.find(e => e.t === type);
    if (e) return { frame: f, ev: e };
  }
  return null;
}

export function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assert(cond, label) {
  if (!cond) throw new Error(label);
}

export { B };
