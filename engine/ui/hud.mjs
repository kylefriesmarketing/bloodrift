// HUD + announcer — Canvas 2D, view-only. Diegetic-leaning per GDD §11:
// vitals bars, blood-bag meter, anatomical wound figure, signature gauges.

const VW = 1280;

export class Hud {
  constructor() {
    this.displayHp = [1, 1];
    this.ghostHp = [1, 1];
    this.queue = [];       // announcer {text, sub, col, t, dur}
    this.comboFlash = [0, 0];
  }

  reset() {
    this.displayHp = [1, 1];
    this.ghostHp = [1, 1];
    this.queue = [];
  }

  say(text, sub, col, dur) {
    this.queue.push({ text, sub: sub || '', col: col || '#f2e9dc', t: 0, dur: dur || 90 });
  }

  consume(sim, evs) {
    for (const e of evs) {
      switch (e.t) {
        case 'fight': this.say('FIGHT', '', '#ff2135', 50); break;
        case 'round': this.say(`ROUND ${sim.roundNum}`, 'the Rift is watching', '#f2e9dc', 80); break;
        case 'roundEnd': {
          if (e.winner === 2) this.say('DOUBLE K.O.', 'the round replays', '#ff2135', 110);
          else {
            const name = sim.fighters[e.winner].char.character.name;
            const how = e.reason === 'bleedout' ? 'BLEED-OUT' : e.reason === 'timeout' ? 'TIME' : 'K.O.';
            this.say(how, `${name} takes the round`, '#ff2135', 120);
          }
          break;
        }
        case 'matchEnd': {
          const name = sim.fighters[e.winner].char.character.name;
          this.say(`${name} WINS`, e.reason === 'bleedout' ? 'the Rift drinks well tonight' : 'feed the Rift', '#ff2135', 900);
          break;
        }
        case 'overdrive': this.say('OVERDRIVE', sim.fighters[e.who].char.movesById[e.move].name, '#ffd97a', 60); break;
        case 'breaker': this.say('TRANSFUSION', '2 pints spent', '#8fd8ff', 45); break;
        case 'bleeding': this.say('BLEEDING', `${sim.fighters[e.who].char.character.name} is losing blood`, '#ff2135', 70); break;
        case 'throwTech': this.say('TECH', '', '#8fa8c8', 30); break;
        case 'sunder':
          this.queue.length = 0;
          this.say(`SUNDERED — ${e.region}`, e.flavor || '', '#ff2135', 130);
          break;
        case 'finishPrompt': {
          const w = sim.fighters[e.winner];
          this.queue.length = 0;
          this.say('FEED THE RIFT', w.ai ? 'the Rift waits for its tithe' : 'RIFT button — execute · or walk away', '#ff2135', 470);
          break;
        }
        case 'execution': {
          this.queue.length = 0;
          this.say(e.name.toUpperCase(), 'the Rift is fed', '#ff2135', 150);
          break;
        }
        case 'spared': {
          this.queue.length = 0;
          this.say('SPARED', 'mercy is also a wager', '#8fa8c8', 120);
          break;
        }
        case 'hit': if (e.combo >= 2) this.comboFlash[1 - e.who] = 90; break;
      }
    }
  }

  draw(cx, sim) {
    if (sim.phase === 'intro' && sim.phaseT > 40 && this.queue.length === 0) {
      this.say(`ROUND ${sim.roundNum}`, sim.roundNum === 1 ? 'duel at the Rift-scar' : 'the Rift is watching', '#f2e9dc', 55);
    }
    const [a, b] = sim.fighters;
    this.bars(cx, sim, a, 0);
    this.bars(cx, sim, b, 1);

    // timer
    cx.textAlign = 'center';
    cx.font = '700 44px Georgia, serif';
    cx.fillStyle = sim.timer <= 10 ? '#ff2135' : '#e8dcc8';
    cx.strokeStyle = 'rgba(0,0,0,0.7)';
    cx.lineWidth = 5;
    const ts = String(Math.max(0, sim.timer)).padStart(2, '0');
    cx.strokeText(ts, VW / 2, 58);
    cx.fillText(ts, VW / 2, 58);
    // round pips
    for (let i = 0; i < 2; i++) {
      for (let r = 0; r < 2; r++) {
        const px = VW / 2 + (i === 0 ? -1 : 1) * (58 + r * 20);
        cx.beginPath();
        cx.arc(px, 74, 6, 0, Math.PI * 2);
        cx.fillStyle = sim.roundWins[i] > r ? '#ff2135' : 'rgba(255,255,255,0.14)';
        cx.fill();
      }
    }

    // combo counters
    for (let i = 0; i < 2; i++) {
      if (this.comboFlash[i] > 0) {
        this.comboFlash[i]--;
        const vic = sim.fighters[1 - i];
        if (vic.comboHits >= 2) {
          const x = i === 0 ? 150 : VW - 150;
          cx.textAlign = i === 0 ? 'left' : 'right';
          cx.font = '800 34px Georgia, serif';
          cx.fillStyle = '#ff2135';
          cx.strokeStyle = 'rgba(0,0,0,0.8)';
          cx.lineWidth = 4;
          const line = `${vic.comboHits} HITS`;
          cx.strokeText(line, x, 200);
          cx.fillText(line, x, 200);
          cx.font = '600 20px Georgia, serif';
          cx.fillStyle = '#e8dcc8';
          cx.strokeText(`${vic.comboDmg}`, x, 226);
          cx.fillText(`${vic.comboDmg}`, x, 226);
        } else if (vic.comboHits === 0) this.comboFlash[i] = 0;
      }
    }

    // announcer — timed by SIM frames so driven/headless modes decay correctly
    if (this.queue.length) {
      const q = this.queue[0];
      if (q.startFrame === undefined) q.startFrame = sim.frame;
      q.t = Math.max(q.t + 1, sim.frame - q.startFrame);
      const k = Math.min(1, q.t / 8);
      const out = q.dur - q.t < 12 ? (q.dur - q.t) / 12 : 1;
      cx.globalAlpha = Math.max(0, Math.min(k, out));
      cx.textAlign = 'center';
      cx.font = `900 ${Math.floor(64 + 10 * (1 - k))}px Georgia, serif`;
      cx.fillStyle = q.col;
      cx.strokeStyle = 'rgba(0,0,0,0.85)';
      cx.lineWidth = 8;
      cx.strokeText(q.text, VW / 2, 320);
      cx.fillText(q.text, VW / 2, 320);
      if (q.sub) {
        cx.font = 'italic 600 22px Georgia, serif';
        cx.fillStyle = '#e8dcc8';
        cx.lineWidth = 4;
        cx.strokeText(q.sub, VW / 2, 356);
        cx.fillText(q.sub, VW / 2, 356);
      }
      cx.globalAlpha = 1;
      if (q.t >= q.dur) this.queue.shift();
    }
  }

  bars(cx, sim, f, side) {
    const ch = f.char.character;
    const pal = ch.palette;
    const x0 = side === 0 ? 40 : VW - 40;
    const dir = side === 0 ? 1 : -1;
    const wMax = 470;

    // health frame (angled vitals slab)
    const hpK = Math.max(0, f.hp / f.hpMax);
    this.displayHp[side] += (hpK - this.displayHp[side]) * 0.2;
    this.ghostHp[side] += (hpK - this.ghostHp[side]) * 0.035;

    cx.save();
    const slab = (w, h, y, col) => {
      cx.fillStyle = col;
      cx.beginPath();
      cx.moveTo(x0, y);
      cx.lineTo(x0 + dir * w, y);
      cx.lineTo(x0 + dir * (w - 14), y + h);
      cx.lineTo(x0, y + h);
      cx.closePath();
      cx.fill();
    };
    slab(wMax + 4, 26, 26, 'rgba(0,0,0,0.65)');
    slab(wMax * this.ghostHp[side], 26, 26, 'rgba(255,120,120,0.35)');
    // hp gradient: bone-white → arterial as it drains
    const low = this.displayHp[side] < 0.3;
    slab(wMax * this.displayHp[side], 26, 26, low ? '#ff2135' : '#d9cdb8');
    if (f.bleedRegions.length > 0 && sim.frame % 30 < 15) {
      slab(wMax * this.displayHp[side], 26, 26, 'rgba(255,33,53,0.45)');
    }
    // EKG-ish tick line for Vanguard, wax seal drips for Court
    cx.strokeStyle = 'rgba(0,0,0,0.35)';
    cx.lineWidth = 1.5;
    cx.beginPath();
    if (ch.faction === 'vanguard') {
      let px = x0, py = 39;
      cx.moveTo(px, py);
      for (let k = 0; k < 22; k++) {
        px += dir * wMax / 22;
        const spike = k % 6 === 2 ? -8 : k % 6 === 3 ? 9 : 0;
        cx.lineTo(px, py + spike);
      }
    } else {
      for (let k = 1; k < 12; k++) {
        cx.moveTo(x0 + dir * (k * wMax / 12), 46);
        cx.lineTo(x0 + dir * (k * wMax / 12), 52 + (k % 3) * 3);
      }
    }
    cx.stroke();

    // name
    cx.textAlign = side === 0 ? 'left' : 'right';
    cx.font = '800 20px Georgia, serif';
    cx.fillStyle = '#efe6d6';
    cx.strokeStyle = 'rgba(0,0,0,0.8)';
    cx.lineWidth = 3;
    cx.strokeText(ch.name, x0, 20);
    cx.fillText(ch.name, x0, 20);
    cx.font = 'italic 500 13px Georgia, serif';
    cx.fillStyle = '#9a8f80';
    cx.fillText(ch.title, x0, 70);

    // blood-bag meter: 3 pint cells filling with the OPPONENT's blood colour
    const oppBlood = sim.fighters[1 - side].char.character.palette.blood;
    const meterY = 82;
    for (let p = 0; p < 3; p++) {
      const cellX = x0 + dir * p * 58;
      const fill = Math.max(0, Math.min(100, f.meter - p * 100)) / 100;
      cx.fillStyle = 'rgba(0,0,0,0.6)';
      rr2(cx, side === 0 ? cellX : cellX - 52, meterY, 52, 13, 4);
      if (fill > 0) {
        cx.fillStyle = oppBlood;
        rr2(cx, side === 0 ? cellX : cellX - 52, meterY, 52 * fill, 13, 4);
      }
      if (fill >= 1) {
        cx.strokeStyle = 'rgba(255,33,53,0.8)';
        cx.lineWidth = 1.5;
        rr2s(cx, side === 0 ? cellX : cellX - 52, meterY, 52, 13, 4);
      }
    }
    if (f.meter >= 300 && sim.frame % 40 < 20) {
      cx.font = '700 11px Georgia, serif';
      cx.fillStyle = '#ff2135';
      cx.fillText('OVERDRIVE READY', x0, meterY + 26);
    }

    // wound figure — the Sunder targeting HUD
    const figX = x0 + dir * (wMax + 26), figY = 30;
    const th = sim.balance.trauma.thresholds;
    const wsOf = r => f.trauma[r] >= th[2] ? 3 : f.trauma[r] >= th[1] ? 2 : f.trauma[r] >= th[0] ? 1 : 0;
    const wCol = ws => ws === 0 ? 'rgba(255,255,255,0.22)' : ws === 1 ? '#b28a2e' : ws === 2 ? '#cc5a1e' : (sim.frame % 20 < 10 ? '#ff2135' : '#8f0f22');
    cx.fillStyle = wCol(wsOf('HEAD'));
    cx.beginPath(); cx.arc(figX, figY, 6, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = wCol(wsOf('BODY'));
    cx.fillRect(figX - 5, figY + 8, 10, 16);
    cx.fillStyle = wCol(wsOf('ARMS'));
    cx.fillRect(figX - 11, figY + 8, 4, 14);
    cx.fillRect(figX + 7, figY + 8, 4, 14);
    cx.fillStyle = wCol(wsOf('LEGS'));
    cx.fillRect(figX - 5, figY + 26, 4, 14);
    cx.fillRect(figX + 1, figY + 26, 4, 14);

    // signature gauges, bottom corners
    const gy = 668;
    cx.textAlign = side === 0 ? 'left' : 'right';
    if (ch.rift_button.mechanic === 'flare') {
      cx.font = '700 12px Georgia, serif';
      cx.fillStyle = '#c9a227';
      cx.fillText('SOLAR DEBT', x0, gy - 8);
      cx.fillStyle = 'rgba(0,0,0,0.6)';
      rr2(cx, side === 0 ? x0 : x0 - 180, gy, 180, 9, 3);
      const dk = f.debt / (ch.rift_button.config.maxDebt || 100);
      if (dk > 0) {
        cx.fillStyle = dk >= 1 ? '#ff8a3a' : '#c9a227';
        rr2(cx, side === 0 ? x0 : x0 - 180 * dk, gy, 180 * dk, 9, 3);
      }
      if (dk >= 1) {
        cx.font = '700 11px Georgia, serif';
        cx.fillStyle = '#ff8a3a';
        cx.fillText('MAX — the star runs hot', x0, gy + 22);
      }
    } else if (ch.rift_button.mechanic === 'bank') {
      const jk = Math.min(1, (f.joules || 0) / (ch.rift_button.config.max || 300));
      cx.font = '700 12px Georgia, serif';
      cx.fillStyle = '#ffcf6a';
      cx.fillText(`KINETIC BANK — ${f.joules || 0} J`, x0, gy - 8);
      cx.fillStyle = 'rgba(0,0,0,0.6)';
      rr2(cx, side === 0 ? x0 : x0 - 180, gy, 180, 9, 3);
      if (jk > 0) {
        cx.fillStyle = jk >= 1 ? '#ffe9a8' : '#d99a2b';
        rr2(cx, side === 0 ? x0 : x0 - 180 * jk, gy, 180 * jk, 9, 3);
      }
      if (jk >= 0.33 && sim.frame % 40 < 20) {
        cx.font = '700 11px Georgia, serif';
        cx.fillStyle = '#ffcf6a';
        cx.fillText('hold RIFT with a special — DISCHARGE', x0, gy + 22);
      }
    } else if (ch.rift_button.mechanic === 'atlas') {
      const cdMax = ch.rift_button.config.roundsCd || 240;
      const ready = 1 - Math.min(1, f.drainCd / cdMax);
      cx.font = '700 12px Georgia, serif';
      cx.fillStyle = '#c8323e';
      cx.fillText(f.marked ? `OPERATING THEATER — ${f.marked} charted` : 'OPERATING THEATER', x0, gy - 8);
      cx.fillStyle = 'rgba(0,0,0,0.6)';
      rr2(cx, side === 0 ? x0 : x0 - 180, gy, 180, 9, 3);
      if (ready > 0) {
        cx.fillStyle = ready >= 1 ? '#e8465a' : '#7a2830';
        rr2(cx, side === 0 ? x0 : x0 - 180 * ready, gy, 180 * ready, 9, 3);
      }
      if (ready >= 1 && !f.marked) {
        cx.font = '700 11px Georgia, serif';
        cx.fillStyle = '#e8465a';
        cx.fillText('ROUNDS ready — RIFT to chart', x0, gy + 22);
      }
    } else if (ch.rift_button.mechanic === 'drain') {
      const cdMax = (f.char.moves.find(m => m.trigger.type === 'rift_press') || {}).cooldown || 150;
      const ready = 1 - Math.min(1, f.drainCd / cdMax);
      cx.font = '700 12px Georgia, serif';
      cx.fillStyle = '#b03040';
      cx.fillText(`THE BLOOD BANK — ${f.facts.drinks} pool${f.facts.drinks === 1 ? '' : 's'} drunk`, x0, gy - 8);
      cx.fillStyle = 'rgba(0,0,0,0.6)';
      rr2(cx, side === 0 ? x0 : x0 - 180, gy, 180, 9, 3);
      if (ready > 0) {
        cx.fillStyle = ready >= 1 ? '#c22a3a' : '#6a1a26';
        rr2(cx, side === 0 ? x0 : x0 - 180 * ready, gy, 180 * ready, 9, 3);
      }
      if (ready >= 1) {
        cx.font = '700 11px Georgia, serif';
        cx.fillStyle = '#c22a3a';
        cx.fillText('SANGUINE DRAW ready', x0, gy + 22);
      }
    } else if (ch.rift_button.mechanic === 'graft_sets') {
      const cfg = ch.rift_button.config || {};
      const labels = cfg.labels || { power: 'POWER', finesse: 'FINESSE' };
      const title = ch.id === 'graft' ? 'BORROWED HANDS' : ch.id === 'lycaon' ? 'THE CHANGE'
        : ch.id === 'flux' ? 'THE SHIFTCORE' : ch.id === 'centurion' ? 'BEARER STANCES' : 'SETS';
      cx.font = '700 12px Georgia, serif';
      cx.fillStyle = '#b8434e';
      cx.fillText(`${title} — ${(labels[f.gset] || f.gset).toUpperCase()}`, x0, gy - 8);
      cx.fillStyle = 'rgba(0,0,0,0.6)';
      rr2(cx, side === 0 ? x0 : x0 - 180, gy, 180, 9, 3);
      const gk = f.graftHp / (cfg.poolMax || 150);
      if (gk > 0) {
        cx.fillStyle = '#8a5a62';
        rr2(cx, side === 0 ? x0 : x0 - 180 * gk, gy, 180 * gk, 9, 3);
      }
    } else if (ch.rift_button.mechanic === 'audit') {
      const cdMax = ch.rift_button.config.auditCd || 200;
      const ready = 1 - Math.min(1, f.drainCd / cdMax);
      const opp = sim.fighters[1 - side];
      const stacks = opp.incisions.ARMS + opp.incisions.BODY + opp.incisions.LEGS + opp.incisions.HEAD;
      cx.font = '700 12px Georgia, serif';
      cx.fillStyle = '#3ec6b8';
      cx.fillText(`THE LEDGER — ${stacks} curse${stacks === 1 ? '' : 's'} recorded`, x0, gy - 8);
      cx.fillStyle = 'rgba(0,0,0,0.6)';
      rr2(cx, side === 0 ? x0 : x0 - 180, gy, 180, 9, 3);
      if (ready > 0) {
        cx.fillStyle = ready >= 1 ? '#3ec6b8' : '#1f6a62';
        rr2(cx, side === 0 ? x0 : x0 - 180 * ready, gy, 180 * ready, 9, 3);
      }
      if (ready >= 1 && stacks > 0) {
        cx.font = '700 11px Georgia, serif';
        cx.fillStyle = '#3ec6b8';
        cx.fillText('AUDIT ready — RIFT to collect', x0, gy + 22);
      }
    } else if (ch.rift_button.mechanic === 'rift_special') {
      const rmv = f.char.moves.find(m => m.trigger.type === 'rift_press');
      const cdMax = (rmv && rmv.cooldown) || 200;
      const ready = 1 - Math.min(1, f.drainCd / cdMax);
      cx.font = '700 12px Georgia, serif';
      cx.fillStyle = '#c8a25a';
      cx.fillText((rmv ? rmv.name : 'RIFT').toUpperCase(), x0, gy - 8);
      cx.fillStyle = 'rgba(0,0,0,0.6)';
      rr2(cx, side === 0 ? x0 : x0 - 180, gy, 180, 9, 3);
      if (ready > 0) {
        cx.fillStyle = ready >= 1 ? '#e8c87a' : '#7a683a';
        rr2(cx, side === 0 ? x0 : x0 - 180 * ready, gy, 180 * ready, 9, 3);
      }
    }
    cx.restore();
  }
}

function rr2(cx, x, y, w, h, r) {
  if (w <= 0) return;
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.arcTo(x + w, y, x + w, y + h, r);
  cx.arcTo(x + w, y + h, x, y + h, r);
  cx.arcTo(x, y + h, x, y, r);
  cx.arcTo(x, y, x + w, y, r);
  cx.closePath();
  cx.fill();
}
function rr2s(cx, x, y, w, h, r) {
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.arcTo(x + w, y, x + w, y + h, r);
  cx.arcTo(x + w, y + h, x, y + h, r);
  cx.arcTo(x, y + h, x, y, r);
  cx.arcTo(x, y, x + w, y, r);
  cx.closePath();
  cx.stroke();
}
