// Deterministic LCG — the only randomness allowed inside the sim
// (the purity test in tests/run.mjs enforces this for the whole directory).

export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return {
    get state() { return s; },
    set state(v) { s = v >>> 0; },
    next() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s;
    },
    // integer in [0, n)
    int(n) {
      return this.next() % n;
    },
    // permille roll: true with p/1000 probability
    chance(permille) {
      return this.int(1000) < permille;
    }
  };
}
