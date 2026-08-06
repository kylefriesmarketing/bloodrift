// WebAudio synth SFX — view-only, event-driven, no audio files.
// Impacts are LAYERED (body thud + surface crack + wet spray) because a single
// sine blip is the difference between a hit that lands and a hit that beeps.
// A tension bed sits under everything and tightens as the round gets bloody.

export class Sfx {
  constructor() {
    this.ac = null;
    this.on = true;
    this.bed = null;
    this.noiseBuf = null;
  }

  ensure() {
    if (!this.ac) {
      try {
        this.ac = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ac.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ac.destination);
      } catch { this.on = false; }
    }
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
  }

  now() { return this.ac.currentTime; }

  noise(dur) {
    if (!this.noiseBuf || this.noiseBuf.duration < dur) {
      const len = Math.ceil(this.ac.sampleRate * Math.max(dur, 1));
      const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    const src = this.ac.createBufferSource();
    src.buffer = this.noiseBuf;
    return src;
  }

  // pitched body — the mass behind a blow
  tone(freq, dur, vol, type = 'sine', bend = 0.4) {
    const t = this.now();
    const o = this.ac.createOscillator();
    const g = this.ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(24, freq * bend), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // filtered noise — the surface: cloth, bone, ceramic, spray
  hiss(cut, dur, vol, type = 'lowpass', q = 1) {
    const t = this.now();
    const src = this.noise(dur);
    const f = this.ac.createBiquadFilter();
    f.type = type; f.frequency.value = cut; f.Q.value = q;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // the layered hit: weight + crack + wet
  impact(dmg, kind) {
    const heavy = Math.min(1, dmg / 90);
    const vol = 0.28 + heavy * 0.42;
    if (kind === 'grab' || kind === 'super') {
      this.tone(58 - heavy * 14, 0.34 + heavy * 0.2, vol, 'sine', 0.3);
      this.hiss(420, 0.26, vol * 0.5);
      this.hiss(2600, 0.09, vol * 0.28, 'bandpass', 2);
    } else if (kind === 'kick') {
      this.tone(96 - heavy * 26, 0.17, vol, 'triangle', 0.35);
      this.hiss(900, 0.11, vol * 0.55);
      this.hiss(3400, 0.05, vol * 0.3, 'highpass');
    } else if (kind === 'proj') {
      this.tone(180 - heavy * 40, 0.13, vol * 0.8, 'sawtooth', 0.25);
      this.hiss(1800, 0.14, vol * 0.4, 'bandpass', 1.4);
    } else {
      this.tone(132 - heavy * 40, 0.12, vol, 'sine', 0.4);
      this.hiss(1200, 0.07, vol * 0.5);
      if (heavy > 0.5) this.hiss(3000, 0.05, vol * 0.3, 'highpass');
    }
    // the wet layer — what makes it BLOODRIFT and not a boxing game
    if (dmg >= 45) this.hiss(700, 0.2, 0.1 + heavy * 0.14, 'bandpass', 0.8);
  }

  // low bed that tightens as somebody starts dying
  bedLevel(k) {
    if (!this.on || !this.ac) return;
    if (!this.bed) {
      const o = this.ac.createOscillator();
      const o2 = this.ac.createOscillator();
      const g = this.ac.createGain();
      const f = this.ac.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 200;
      o.type = 'sawtooth'; o.frequency.value = 36;
      o2.type = 'sine'; o2.frequency.value = 54.5; // slight beat against the saw
      g.gain.value = 0;
      o.connect(f); o2.connect(f);
      f.connect(g).connect(this.master);
      o.start(); o2.start();
      this.bed = { g, f, o2 };
    }
    const t = this.now();
    this.bed.g.gain.linearRampToValueAtTime(0.015 + k * 0.05, t + 0.6);
    this.bed.f.frequency.linearRampToValueAtTime(150 + k * 420, t + 0.6);
    this.bed.o2.frequency.linearRampToValueAtTime(54.5 + k * 9, t + 0.6);
  }

  consume(evs, sim) {
    if (!this.on || !this.ac) return;
    for (const e of evs) {
      switch (e.t) {
        case 'hit': this.impact(e.dmg || 20, e.kind || 'punch'); break;
        case 'grabHit': this.impact(e.dmg || 60, 'grab'); break;
        case 'block': this.tone(300, 0.05, 0.16, 'square', 0.6); this.hiss(1600, 0.05, 0.1, 'bandpass', 3); break;
        case 'parry': this.tone(880, 0.09, 0.2, 'triangle', 1.6); this.hiss(5200, 0.06, 0.12, 'highpass'); break;
        case 'armor': case 'absorb': this.tone(190, 0.1, 0.24, 'square', 0.5); break;
        case 'bank': this.tone(220, 0.14, 0.2, 'triangle', 2.2); break;
        case 'clash': this.tone(520, 0.07, 0.2, 'square', 1.4); this.hiss(4200, 0.05, 0.14, 'highpass'); break;
        case 'projSpawn': this.tone(420, 0.1, 0.13, 'sawtooth', 0.35); this.hiss(2200, 0.08, 0.07, 'bandpass', 2); break;
        case 'land': this.tone(70, 0.11, e.hard ? 0.34 : 0.16, 'sine', 0.4); this.hiss(500, 0.09, e.hard ? 0.2 : 0.08); break;
        case 'overdrive': this.tone(48, 0.8, 0.6, 'sawtooth', 0.2); this.hiss(300, 0.6, 0.24); break;
        case 'roundEnd': this.tone(44, 1.0, 0.55, 'sine', 0.25); this.hiss(260, 0.7, 0.2); break;
        case 'wound': this.hiss(600, 0.22, 0.2, 'bandpass', 0.7); break;
        case 'throwTech': this.tone(400, 0.06, 0.18, 'square', 1.2); break;
        case 'flare': this.tone(640, 0.14, 0.18, 'triangle', 1.8); break;
        case 'drain': case 'drink': this.tone(150, 0.22, 0.14, 'sine', 2.4); this.hiss(900, 0.18, 0.08, 'bandpass', 1.2); break;
        case 'sunder':
          this.tone(52, 0.6, 0.85, 'sine', 0.22);
          this.hiss(240, 0.5, 0.4);
          this.hiss(3200, 0.12, 0.3, 'highpass');   // the crack
          this.tone(900, 0.1, 0.2, 'square', 0.4);
          break;
        case 'execution': this.tone(38, 1.4, 0.9, 'sine', 0.2); this.hiss(200, 1.1, 0.35); break;
        case 'finishPrompt': this.tone(80, 0.9, 0.4, 'sine', 0.5); break;
        case 'spared': this.tone(300, 0.5, 0.2, 'sine', 1.6); break;
        case 'audit': this.tone(260, 0.3, 0.24, 'sawtooth', 0.5); this.hiss(1400, 0.25, 0.14, 'bandpass', 2); break;
        case 'incision': this.hiss(4000, 0.06, 0.12, 'highpass'); break;
      }
    }
    // tension bed follows whoever is closest to death
    if (sim && sim.phase === 'fight') {
      const worst = Math.min(...sim.fighters.map(f => f.hp / f.hpMax));
      this.bedLevel(Math.max(0, Math.min(1, 1 - worst)));
    } else if (this.bed) {
      this.bedLevel(0);
    }
  }
}
