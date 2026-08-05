// Lean WebAudio synth SFX — view-only, event-driven. No audio files.
export class Sfx {
  constructor() {
    this.ac = null;
    this.on = true;
  }
  ensure() {
    if (!this.ac) {
      try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.on = false; }
    }
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
  }
  now() { return this.ac.currentTime; }

  thud(freq, dur, vol, noise) {
    if (!this.on || !this.ac) return;
    const t = this.now();
    const o = this.ac.createOscillator();
    const g = this.ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.4), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ac.destination);
    o.start(t); o.stop(t + dur + 0.02);
    if (noise) {
      const len = Math.floor(this.ac.sampleRate * dur);
      const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ac.createBufferSource();
      src.buffer = buf;
      const f = this.ac.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 900;
      const g2 = this.ac.createGain();
      g2.gain.setValueAtTime(vol * 0.7, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f).connect(g2).connect(this.ac.destination);
      src.start(t);
    }
  }

  consume(evs) {
    if (!this.on || !this.ac) return;
    for (const e of evs) {
      switch (e.t) {
        case 'hit': this.thud(150 - Math.min(70, (e.dmg || 20)), 0.14, 0.5, true); break;
        case 'grabHit': this.thud(70, 0.3, 0.7, true); break;
        case 'block': this.thud(320, 0.06, 0.18, false); break;
        case 'parry': this.thud(760, 0.1, 0.25, false); break;
        case 'armor': case 'absorb': this.thud(210, 0.09, 0.3, false); break;
        case 'clash': this.thud(500, 0.07, 0.2, false); break;
        case 'projSpawn': this.thud(430, 0.08, 0.12, false); break;
        case 'overdrive': this.thud(52, 0.7, 0.8, true); break;
        case 'roundEnd': this.thud(46, 0.9, 0.85, true); break;
        case 'wound': this.thud(120, 0.2, 0.4, true); break;
        case 'throwTech': this.thud(400, 0.06, 0.2, false); break;
        case 'flare': this.thud(600, 0.12, 0.2, false); break;
        case 'sunder': this.thud(60, 0.55, 0.9, true); this.thud(900, 0.08, 0.2, false); break;
        case 'execution': this.thud(40, 1.2, 0.95, true); break;
        case 'finishPrompt': this.thud(80, 0.8, 0.4, false); break;
        case 'spared': this.thud(300, 0.4, 0.25, false); break;
      }
    }
  }
}
