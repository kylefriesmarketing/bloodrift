// Input bitmasks + per-fighter tracker (direction history, motion detection, press buffer).
// All state serializable; motions are resolved facing-relative (numpad notation).

export const B = {
  L: 1, R: 2, U: 4, D: 8,
  FP: 16, BP: 32, FK: 64, BK: 128,
  TH: 256, BL: 512, RF: 1024
};

export const BUTTONS = ['FP', 'BP', 'FK', 'BK', 'TH', 'BL', 'RF'];

// numpad dir from bitmask, relative to facing (6 = toward opponent)
export function numpadDir(mask, facing) {
  let h = 0;
  if (mask & B.L) h -= 1;
  if (mask & B.R) h += 1;
  h *= facing; // +1 = forward
  let v = 0;
  if (mask & B.U) v = 1;
  else if (mask & B.D) v = -1;
  return 5 + h + v * 3;
}

const HIST = 24;

export class InputTracker {
  constructor() {
    this.cur = 0;
    this.prev = 0;
    this.dirs = new Array(HIST).fill(5); // ring buffer of numpad dirs, newest at head
    this.head = 0;
    this.rfHeldFrames = 0;
  }

  step(mask, facing) {
    this.prev = this.cur;
    this.cur = mask;
    this.head = (this.head + 1) % HIST;
    this.dirs[this.head] = numpadDir(mask, facing);
    this.rfHeldFrames = (mask & B.RF) ? this.rfHeldFrames + 1 : 0;
  }

  pressed(bit) { return (this.cur & bit) && !(this.prev & bit); }
  released(bit) { return !(this.cur & bit) && (this.prev & bit); }
  held(bit) { return (this.cur & bit) !== 0; }

  dirAt(ago) { return this.dirs[(this.head - ago + HIST * 4) % HIST]; }

  // subsequence match: seq (oldest..newest) appears in the last `window` frames
  matchSeq(seq, window) {
    let si = seq.length - 1;
    for (let ago = 0; ago < window && ago < HIST; ago++) {
      if (this.dirAt(ago) === seq[si]) {
        si--;
        if (si < 0) return true;
      }
    }
    return false;
  }

  // detect motion at this frame (call when a button was just pressed).
  // hcb REQUIRES the down-forward diagonal so a walk-forward 6 lingering in history
  // can't turn a qcb into a half-circle; dp wins over qcf only when the press
  // happens on the down-forward diagonal (the classic shortcut discriminator).
  motion() {
    if (this.matchSeq([6, 3, 2, 4], 18)) return 'hcb';
    const onDf = this.dirAt(0) === 3 || this.dirAt(1) === 3;
    if (onDf && this.matchSeq([6, 2, 3], 15)) return 'dp';
    if (this.matchSeq([2, 3, 6], 12)) return 'qcf';
    if (this.matchSeq([2, 1, 4], 12)) return 'qcb';
    if (!onDf && this.matchSeq([6, 2, 3], 15)) return 'dp';
    if (this.matchSeq([4, 5, 6], 12) || this.matchSeq([4, 6], 10)) return 'bf';
    if (this.matchSeq([2, 5, 2], 14)) return 'dd';
    return null;
  }

  serialize() {
    return { c: this.cur, p: this.prev, d: this.dirs.join(','), h: this.head, r: this.rfHeldFrames };
  }

  restore(s) {
    this.cur = s.c; this.prev = s.p;
    this.dirs = s.d.split(',').map(Number);
    this.head = s.h; this.rfHeldFrames = s.r;
  }
}
