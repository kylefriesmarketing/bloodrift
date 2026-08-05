// World renderer — Canvas 2D. View-only: reads sim state + events, never writes it.
// Math.random is ALLOWED here (render-side spray/shake only; the sim stays pure).
// Art direction (GDD §11): desaturated world, blood is the brightest thing on screen.

import { SCALE, resolveMove } from '../sim/sim.mjs';

const VW = 1280, VH = 720, FLOOR_Y = 596;

export class Renderer {
  constructor(canvas, arena) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    this.arena = arena;
    this.camX = arena.width / 2;
    this.camS = 0.9;
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.parts = [];      // particles
    this.flashT = 0;
    this.flashCol = '#fff';
    this.healFx = [0, 0];
    this.t = 0;
    // persistent gore decals, world-space floor strip
    this.decal = document.createElement('canvas');
    this.decal.width = arena.width;
    this.decal.height = 260;
    this.dcx = this.decal.getContext('2d');
    this.displayHp = [1, 1]; // ghost health fractions
  }

  reset() {
    this.dcx.clearRect(0, 0, this.decal.width, this.decal.height);
    this.parts = [];
    this.shakeT = 0;
    this.flashT = 0;
    this.boneT = 0;
    this.execT = 0;
    this.healFx = [0, 0];
    this.displayHp = [1, 1];
  }

  // ---- events → fx
  consume(sim, evs) {
    for (const e of evs) {
      switch (e.t) {
        case 'hit': case 'grabHit': {
          const vic = sim.fighters[e.who], atk = sim.fighters[1 - e.who];
          const dir = Math.sign(vic.x - atk.x) || 1;
          this.spark(e.x ?? vic.x / SCALE, (e.y ?? 130), '#fff', 9 + Math.min(14, (e.dmg || 20) / 8));
          this.shake(Math.min(13, 3 + (e.dmg || 20) / 14));
          if (e.counter) this.flash('#ffd97a', 5);
          break;
        }
        case 'blood': {
          const vic = sim.fighters[e.who], atk = sim.fighters[1 - e.who];
          const dir = Math.sign(vic.x - atk.x) || 1;
          const col = vic.char.character.palette.blood;
          const n = Math.max(5, Math.min(30, Math.floor(e.vol / 4)));
          for (let k = 0; k < n; k++) {
            this.parts.push({
              type: 'drop', col,
              x: e.x, y: e.y + (Math.random() - 0.5) * 40,
              vx: dir * (1.5 + Math.random() * 5.5) + (Math.random() - 0.5) * 2,
              vy: -(1 + Math.random() * 5),
              g: 0.42, size: 1.5 + Math.random() * 2.8, life: 90
            });
          }
          break;
        }
        case 'drain': case 'drink': {
          this.healFx[e.who] = 22;
          this.spark(sim.fighters[e.who].x / SCALE, 160, '#b03040', 7, true);
          break;
        }
        case 'block': this.spark(sim.fighters[e.who].x / SCALE, 150, '#8fa8c8', 7, true); break;
        case 'parry': this.spark(sim.fighters[e.who].x / SCALE, 170, '#ffd97a', 13, true); this.flash('#ffd97a', 4); break;
        case 'armor': case 'absorb': this.spark(sim.fighters[e.who].x / SCALE, 150, '#c98a4a', 8, true); break;
        case 'clash': this.spark(e.x, e.y, '#ddd', 8); break;
        case 'overdrive': this.flash('#ff2135', 12); break;
        case 'breaker': this.flash('#8fd8ff', 6); break;
        case 'roundEnd': this.flash('#ff2135', 10); this.shake(15); break;
        case 'flare': this.flash('#ffd97a', 3); break;
        case 'sunder': {
          this.flash('#ff2135', 10);
          this.shake(17);
          this.boneT = 52;
          this.boneWho = e.who;
          this.boneRegion = e.region;
          break;
        }
        case 'execution': {
          this.flash('#ff2135', 14);
          this.shake(19);
          this.execT = 140;
          const loser = sim.fighters[e.who];
          const col = loser.char.character.palette.blood;
          for (let k = 0; k < 130; k++) {
            this.parts.push({
              type: 'drop', col,
              x: loser.x / SCALE + (Math.random() - 0.5) * 60,
              y: 40 + Math.random() * 120,
              vx: (Math.random() - 0.5) * 9,
              vy: 2 + Math.random() * 7.5,
              g: 0.42, size: 1.6 + Math.random() * 3.2, life: 130
            });
          }
          break;
        }
        case 'finishPrompt': this.dimT = 9999; break;
        case 'matchEnd': this.dimT = 0; break;
      }
    }
  }

  shake(amp) { this.shakeT = 14; this.shakeAmp = Math.max(this.shakeAmp, amp); }
  flash(col, t) { this.flashT = Math.max(this.flashT, t); this.flashCol = col; }

  spark(wx, wy, col, r, soft) {
    this.parts.push({ type: 'spark', x: wx, y: wy, col, r, life: soft ? 8 : 10, max: soft ? 8 : 10 });
    if (!soft) {
      for (let k = 0; k < 5; k++) {
        const a = Math.random() * Math.PI * 2;
        this.parts.push({
          type: 'slash', x: wx, y: wy, a, col: Math.random() < 0.5 ? '#fff' : '#ff2135',
          len: 14 + Math.random() * 26, life: 7, max: 7
        });
      }
    }
  }

  // ---- frame
  draw(sim) {
    this.t++;
    const cx = this.cx;
    const [a, b] = sim.fighters;
    // camera
    const mid = (a.x + b.x) / 2 / SCALE;
    const dist = Math.abs(a.x - b.x) / SCALE;
    const targS = Math.max(0.62, Math.min(0.95, 1150 / (dist + 560)));
    this.camS += (targS - this.camS) * 0.06;
    const half = VW / 2 / this.camS;
    const targX = Math.max(half - 60, Math.min(this.arena.width - half + 60, mid));
    this.camX += (targX - this.camX) * 0.12;

    let sx = 0, sy = 0;
    if (this.shakeT > 0) {
      this.shakeT--;
      const k = this.shakeAmp * (this.shakeT / 14);
      sx = (Math.random() - 0.5) * k * 2;
      sy = (Math.random() - 0.5) * k;
      if (this.shakeT === 0) this.shakeAmp = 0;
    }

    const W2S = wx => (wx - this.camX) * this.camS + VW / 2 + sx;
    const Y2S = wy => FLOOR_Y - wy * this.camS + sy;
    this.W2S = W2S; this.Y2S = Y2S;

    // ---------- backdrop
    const look = this.arena.look || {};
    const g = cx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#07060a');
    g.addColorStop(0.55, look.sky || '#0b0a10');
    g.addColorStop(1, '#151015');
    cx.fillStyle = g;
    cx.fillRect(0, 0, VW, VH);

    // far ruins bands (parallax)
    const bands = look.bands || ['#141019', '#100d14'];
    bands.forEach((col, bi) => {
      const par = 0.2 + bi * 0.16;
      cx.fillStyle = col;
      const off = -this.camX * par * this.camS;
      for (let i = -1; i < 6; i++) {
        const bx = ((i * 420 + off) % (VW + 420) + VW + 420) % (VW + 420) - 420;
        const h = 150 + ((i * 73 + bi * 131) % 120);
        cx.fillRect(bx, FLOOR_Y - h - 60 - bi * 40, 200 + (i * 37 % 90), h + 200);
      }
    });

    // the Rift-scar
    const scarX = W2S(this.arena.scarX);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 0.05);
    const sg = cx.createLinearGradient(scarX, FLOOR_Y - 320, scarX, FLOOR_Y + 40);
    sg.addColorStop(0, 'rgba(255,33,53,0)');
    sg.addColorStop(0.7, `rgba(255,33,53,${0.16 + pulse * 0.12})`);
    sg.addColorStop(1, `rgba(255,33,53,${0.30 + pulse * 0.14})`);
    cx.fillStyle = sg;
    cx.fillRect(scarX - 60, FLOOR_Y - 320, 120, 360);
    cx.strokeStyle = `rgba(255,60,75,${0.5 + pulse * 0.3})`;
    cx.lineWidth = 2.5;
    cx.beginPath();
    let zy = FLOOR_Y + 20;
    cx.moveTo(scarX, zy);
    for (let k = 0; k < 7; k++) {
      zy -= 34;
      cx.lineTo(scarX + ((k * 47) % 26 - 13) * (0.7 + pulse * 0.3), zy);
    }
    cx.stroke();
    if (this.t % 5 === 0) {
      this.parts.push({
        type: 'ember', x: this.arena.scarX + (Math.random() - 0.5) * 40, y: -10 - Math.random() * 30,
        vx: (Math.random() - 0.5) * 0.4, vy: -(0.4 + Math.random() * 0.9),
        col: '#ff4a58', size: 1 + Math.random() * 2, life: 120
      });
    }

    // ---------- floor
    cx.fillStyle = look.ground || '#181419';
    cx.fillRect(0, FLOOR_Y, VW, VH - FLOOR_Y);
    cx.fillStyle = look.groundEdge || '#241d22';
    cx.fillRect(0, FLOOR_Y, VW, 4);
    // floor seams
    cx.strokeStyle = 'rgba(0,0,0,0.35)';
    cx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const wx = i * 220;
      const fx = W2S(wx);
      cx.beginPath(); cx.moveTo(fx, FLOOR_Y); cx.lineTo(fx - 60, VH); cx.stroke();
    }

    // gore decals (world strip drawn with camera transform)
    cx.save();
    cx.translate(W2S(0), FLOOR_Y - 30 * this.camS);
    cx.scale(this.camS, this.camS);
    cx.globalAlpha = 0.92;
    cx.drawImage(this.decal, 0, 0);
    cx.restore();

    // pools — glossy, faintly luminous, crawling toward the scar
    for (const p of sim.pools) {
      const px = W2S(p.x / SCALE), pr = p.r * this.camS;
      const pg = cx.createRadialGradient(px, FLOOR_Y + 14, pr * 0.15, px, FLOOR_Y + 14, pr);
      pg.addColorStop(0, '#6e0d1d');
      pg.addColorStop(0.75, '#4a0812');
      pg.addColorStop(1, '#38060d');
      cx.fillStyle = pg;
      cx.beginPath();
      cx.ellipse(px, FLOOR_Y + 14, pr, pr * 0.24, 0, 0, Math.PI * 2);
      cx.fill();
      cx.strokeStyle = `rgba(255,33,53,${0.20 + 0.12 * Math.sin(this.t * 0.06 + p.x)})`;
      cx.lineWidth = 1.4;
      cx.stroke();
      cx.fillStyle = 'rgba(255,255,255,0.06)';
      cx.beginPath();
      cx.ellipse(px - pr * 0.3, FLOOR_Y + 11, pr * 0.32, pr * 0.07, 0, 0, Math.PI * 2);
      cx.fill();
    }

    // ---------- fighters (draw loser-last so winner overlaps at KO? draw by x order)
    const order = a.x <= b.x ? [a, b] : [b, a];
    for (const f of order) this.drawFighter(cx, sim, f);

    // ---------- projectiles
    for (const p of sim.projectiles) {
      const px = W2S(p.x / SCALE), py = Y2S(p.y / SCALE);
      const mv = sim.fighters[p.owner].char.movesById[p.moveId];
      const isFlare = p.variant === 'flare';
      if (p.moveId === 'sunlance') {
        const col = isFlare ? '#ffd97a' : '#ffc44a';
        const grad = cx.createLinearGradient(px - 40 * Math.sign(p.vx), py, px + 20 * Math.sign(p.vx), py);
        grad.addColorStop(0, 'rgba(255,150,60,0)');
        grad.addColorStop(1, col);
        cx.fillStyle = grad;
        cx.beginPath();
        cx.ellipse(px, py, (p.w / 2 + 14) * this.camS, (p.h / 2 + 4) * this.camS, 0, 0, Math.PI * 2);
        cx.fill();
        cx.fillStyle = '#fff7dd';
        cx.beginPath();
        cx.ellipse(px, py, p.w / 2 * this.camS * 0.7, p.h / 2 * this.camS * 0.7, 0, 0, Math.PI * 2);
        cx.fill();
      } else {
        cx.save();
        cx.translate(px, py);
        cx.rotate(this.t * 0.4 * Math.sign(p.vx));
        cx.fillStyle = '#8a8f98';
        cx.fillRect(-p.w / 2 * this.camS, -p.h / 2 * this.camS, p.w * this.camS, p.h * this.camS);
        cx.strokeStyle = '#3a3f46';
        cx.strokeRect(-p.w / 2 * this.camS, -p.h / 2 * this.camS, p.w * this.camS, p.h * this.camS);
        cx.restore();
      }
    }

    // ---------- particles
    this.parts = this.parts.filter(p => {
      p.life--;
      if (p.life <= 0) return false;
      if (p.type === 'drop' || p.type === 'ember') {
        p.x += p.vx; p.y += p.vy * -1 * 0 + 0; // world y positive-up handled below
      }
      return true;
    });
    // (particles use world coords: x world-px, y = height above floor)
    for (const p of this.parts) {
      if (p.type === 'drop') {
        p.vy += p.g ? -p.g : 0; // vy positive up; gravity pulls down
        p.x += p.vx; p.y += p.vy;
        if (p.y <= 2) {
          // splat into the decal strip
          const d = this.dcx;
          d.fillStyle = p.col;
          d.globalAlpha = 0.5 + Math.random() * 0.4;
          d.beginPath();
          d.ellipse(p.x, 30 + 14 + Math.random() * 26, p.size * (1.5 + Math.random() * 2.2), p.size * (0.5 + Math.random() * 0.6), 0, 0, Math.PI * 2);
          d.fill();
          if (Math.random() < 0.3) {
            d.beginPath();
            d.ellipse(p.x + (Math.random() - 0.5) * 26, 40 + Math.random() * 24, 1.5, 0.8, 0, 0, Math.PI * 2);
            d.fill();
          }
          d.globalAlpha = 1;
          p.life = 0;
          continue;
        }
        cx.fillStyle = p.col;
        cx.beginPath();
        cx.ellipse(W2S(p.x), Y2S(p.y), p.size * this.camS, p.size * 1.5 * this.camS, 0, 0, Math.PI * 2);
        cx.fill();
      } else if (p.type === 'ember') {
        p.x += p.vx; p.y -= p.vy; // vy negative → rises
        cx.globalAlpha = Math.min(1, p.life / 60) * 0.8;
        cx.fillStyle = p.col;
        cx.fillRect(W2S(p.x), Y2S(p.y), 2, 2);
        cx.globalAlpha = 1;
      } else if (p.type === 'spark') {
        const k = p.life / p.max;
        cx.strokeStyle = p.col;
        cx.globalAlpha = k;
        cx.lineWidth = 2.5;
        cx.beginPath();
        cx.arc(W2S(p.x), Y2S(p.y), p.r * (1.6 - k) * 2.2 * this.camS, 0, Math.PI * 2);
        cx.stroke();
        cx.globalAlpha = 1;
      } else if (p.type === 'slash') {
        const k = p.life / p.max;
        cx.strokeStyle = p.col;
        cx.globalAlpha = k;
        cx.lineWidth = 2;
        const px = W2S(p.x), py = Y2S(p.y);
        const ex = Math.cos(p.a) * p.len * (2 - k), ey = Math.sin(p.a) * p.len * (2 - k);
        cx.beginPath();
        cx.moveTo(px - ex * 0.3, py - ey * 0.3);
        cx.lineTo(px + ex, py + ey);
        cx.stroke();
        cx.globalAlpha = 1;
      }
    }

    // sunder bone-cam overlay: the X-ray beat
    if (this.boneT > 0) {
      this.boneT--;
      const f = sim.fighters[this.boneWho];
      const bx = W2S(f.x / SCALE), byc = Y2S(f.y / SCALE) - 120 * this.camS;
      const k = this.boneT / 52;
      cx.globalAlpha = Math.min(0.85, k * 1.4);
      const rg = cx.createRadialGradient(bx, byc, 8, bx, byc, 170 * this.camS);
      rg.addColorStop(0, 'rgba(255,33,53,0.55)');
      rg.addColorStop(1, 'rgba(255,33,53,0)');
      cx.fillStyle = rg;
      cx.fillRect(bx - 180, byc - 180, 360, 360);
      // schematic bones — spine, ribs, limbs; the broken region flickers
      cx.strokeStyle = this.boneT % 4 < 2 ? '#ffffff' : '#ffd9d9';
      cx.lineWidth = 3 * this.camS;
      cx.beginPath();
      cx.moveTo(bx, byc - 70 * this.camS); cx.lineTo(bx, byc + 60 * this.camS); // spine
      for (let r = 0; r < 4; r++) {
        cx.moveTo(bx - 26 * this.camS, byc - 40 * this.camS + r * 16 * this.camS);
        cx.lineTo(bx + 26 * this.camS, byc - 40 * this.camS + r * 16 * this.camS); // ribs
      }
      cx.moveTo(bx, byc - 46 * this.camS); cx.lineTo(bx - 52 * this.camS, byc + 6 * this.camS);  // arms
      cx.moveTo(bx, byc - 46 * this.camS); cx.lineTo(bx + 52 * this.camS, byc + 6 * this.camS);
      cx.moveTo(bx, byc + 60 * this.camS); cx.lineTo(bx - 30 * this.camS, byc + 128 * this.camS); // legs
      cx.moveTo(bx, byc + 60 * this.camS); cx.lineTo(bx + 30 * this.camS, byc + 128 * this.camS);
      cx.stroke();
      // the break: jagged red fracture across the region
      cx.strokeStyle = '#ff2135';
      cx.lineWidth = 4 * this.camS;
      const ry = this.boneRegion === 'HEAD' ? -84 : this.boneRegion === 'ARMS' ? -20 : this.boneRegion === 'BODY' ? -10 : 96;
      const rx = this.boneRegion === 'ARMS' ? -40 : this.boneRegion === 'LEGS' ? -18 : 0;
      cx.beginPath();
      cx.moveTo(bx + (rx - 16) * this.camS, byc + ry * this.camS);
      cx.lineTo(bx + (rx - 2) * this.camS, byc + (ry + 8) * this.camS);
      cx.lineTo(bx + (rx + 4) * this.camS, byc + (ry - 6) * this.camS);
      cx.lineTo(bx + (rx + 18) * this.camS, byc + (ry + 4) * this.camS);
      cx.stroke();
      cx.globalAlpha = 1;
    }

    // FEED THE RIFT: the arena dims and the pools reach for the loser
    if (sim.phase === 'finish') {
      cx.fillStyle = 'rgba(4,2,6,0.42)';
      cx.fillRect(0, 0, VW, VH);
      const pulse2 = 0.5 + 0.5 * Math.sin(this.t * 0.11);
      for (const p of sim.pools) {
        const px = W2S(p.x / SCALE), pr = p.r * this.camS;
        cx.strokeStyle = `rgba(255,33,53,${0.35 + pulse2 * 0.35})`;
        cx.lineWidth = 2;
        cx.beginPath();
        cx.ellipse(px, FLOOR_Y + 14, pr * (1 + pulse2 * 0.1), pr * 0.26, 0, 0, Math.PI * 2);
        cx.stroke();
      }
    }
    if (this.execT > 0) {
      this.execT--;
      cx.fillStyle = `rgba(120,4,14,${0.16 * (this.execT / 140)})`;
      cx.fillRect(0, 0, VW, VH);
    }

    // vignette + grain-ish scan
    const vg = cx.createRadialGradient(VW / 2, VH / 2, VH / 2.4, VW / 2, VH / 2, VH);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    cx.fillStyle = vg;
    cx.fillRect(0, 0, VW, VH);

    // superflash
    if (sim.superFlashT > 0) {
      cx.fillStyle = `rgba(255,33,53,${0.10 + 0.1 * Math.sin(this.t * 0.8)})`;
      cx.fillRect(0, 0, VW, VH);
      const who = sim.fighters.find(f => f.state === 'move' && f.char.movesById[f.moveId] && f.char.movesById[f.moveId].kind === 'overdrive');
      if (who) {
        const fx = W2S(who.x / SCALE);
        const rg = cx.createRadialGradient(fx, FLOOR_Y - 120, 10, fx, FLOOR_Y - 120, 320);
        rg.addColorStop(0, 'rgba(255,255,255,0.35)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        cx.fillStyle = rg;
        cx.fillRect(0, 0, VW, VH);
      }
    }

    // screen flash — capped so it accents the moment instead of erasing the frame
    if (this.flashT > 0) {
      this.flashT--;
      cx.globalAlpha = Math.min(0.5, 0.055 * this.flashT);
      cx.fillStyle = this.flashCol;
      cx.fillRect(0, 0, VW, VH);
      cx.globalAlpha = 1;
    }
  }

  // ---------- one fighter
  drawFighter(cx, sim, f) {
    const W2S = this.W2S, Y2S = this.Y2S;
    const pal = f.char.character.palette;
    const st = f.char.character.stats;
    const x = W2S(f.x / SCALE);
    const yBase = Y2S(f.y / SCALE);
    const s = this.camS;
    const H = st.height * s;
    const W = st.width * s * 0.86;
    const face = f.facing;
    const t = this.t;

    // pose params
    let crouchK = 0, lean = 0, tilt = 0, bob = Math.sin(t * 0.07 + f.id * 3) * 1.5 * s;
    let armX = 0, armY = 0.62, legX = 0, guard = false, lying = false;
    let mv = null, activeK = 0, useLimb = 'ARMS';
    switch (f.state) {
      case 'crouch': crouchK = 0.38; break;
      case 'walkF': lean = 0.05 * face; break;
      case 'walkB': lean = -0.04 * face; break;
      case 'dashF': lean = 0.16 * face; bob = 0; break;
      case 'dashB': lean = -0.13 * face; bob = 0; break;
      case 'prejump': crouchK = 0.3; break;
      case 'air': tilt = 0.08 * face; break;
      case 'hitstun': tilt = -0.22 * face; bob = 0; break;
      case 'blockstun': guard = true; tilt = -0.06 * face; break;
      case 'launched': tilt = Math.max(-1.4, Math.min(1.4, -f.vy / 9000)) * face; break;
      case 'kd': case 'ko': lying = true; break;
      case 'wakeup': crouchK = 0.5 * (1 - f.stateT / Math.max(1, f.stateDur)); break;
      case 'stance': crouchK = 0.22; guard = true; break;
      case 'grabbing': lean = 0.12 * face; break;
      case 'grabbed': case 'thrown': tilt = -0.15 * face; break;
      case 'move': {
        mv = resolveMove(f.char, f.moveId, f.moveVar);
        const fr = mv.frames;
        useLimb = mv.uses || 'ARMS';
        if (f.moveF <= fr.startup) activeK = 0.55 * (f.moveF / Math.max(1, fr.startup));
        else if (f.moveF <= fr.startup + fr.active) activeK = 1;
        else activeK = Math.max(0, 0.7 * (1 - (f.moveF - fr.startup - fr.active) / Math.max(1, fr.recovery)));
        lean = 0.1 * face * activeK;
        break;
      }
    }
    // block-ready visual (holding block outside stun)
    if (!mv && (f.state === 'idle' || f.state === 'walkB' || f.state === 'crouch')) {
      const tr = sim.trackers[f.id];
      if (tr.cur & 512) guard = true;
    }

    const cid = f.char.character.id;
    const bodyH = H * (1 - crouchK * 0.42);
    const torsoW = W * (cid === 'graft' ? 1.28 : cid === 'strigoi' ? 0.92 : 1);
    const outline = '#070507';

    cx.save();
    // shadow
    cx.fillStyle = 'rgba(0,0,0,0.5)';
    cx.beginPath();
    cx.ellipse(x, Y2S(0) + 10, W * 0.9, 7 * s, 0, 0, Math.PI * 2);
    cx.fill();

    cx.translate(x, yBase);
    if (lying) {
      cx.rotate(-Math.PI / 2 * face * 0.94);
      cx.translate(0, -W * 0.3);
    } else {
      cx.rotate(lean + tilt * 0.6);
    }
    cx.translate(0, bob);

    // hit flash
    const justHit = f.state === 'hitstun' && f.stateT < 3;

    const torsoY = -bodyH * 0.52;
    const headR = W * 0.34;

    // total blood-paint tint
    const totalTrauma = f.trauma.ARMS + f.trauma.BODY + f.trauma.LEGS + f.trauma.HEAD;
    const gore = Math.min(0.38, totalTrauma / 1400);

    // legs
    const legW = W * 0.24, legH = bodyH * 0.4;
    const step = (f.state === 'walkF' || f.state === 'walkB') ? Math.sin(t * 0.25) * 6 * s : 0;
    cx.strokeStyle = '#070507';
    cx.lineWidth = 2.4 * s;
    cx.fillStyle = shade(pal.secondary, 14);
    rrs(cx, -W * 0.32 - step * 0.4, -legH, legW, legH, 4 * s);
    rrs(cx, W * 0.10 + step * 0.4, -legH, legW, legH, 4 * s);
    // kick extend
    if (mv && useLimb === 'LEGS' && activeK > 0.2) {
      cx.fillStyle = shade(pal.secondary, 10);
      const kl = (W * 0.9 + activeK * W * 1.35);
      cx.save();
      cx.translate(0, -legH * (mv.guard === 'low' ? 0.3 : 0.95));
      cx.rotate(face > 0 ? 0 : Math.PI);
      rr(cx, 0, -legW / 2, kl, legW, 5 * s);
      cx.restore();
    }

    // strigoi: funeral-silk greatcoat flares behind everything
    if (cid === 'strigoi') {
      cx.fillStyle = shade(pal.secondary, 6);
      cx.beginPath();
      cx.moveTo(-torsoW * 0.5, torsoY - 4 * s);
      cx.lineTo(torsoW * 0.5, torsoY - 4 * s);
      cx.lineTo(torsoW * 0.95 + Math.sin(t * 0.09) * 3 * s, -4 * s);
      cx.lineTo(-torsoW * 0.95 - Math.sin(t * 0.09 + 1) * 3 * s, -4 * s);
      cx.closePath();
      cx.fill();
      cx.strokeStyle = shade(pal.accent, -30);
      cx.lineWidth = 1.5 * s;
      cx.stroke();
    }

    // torso (rim-lit against the dark arena)
    cx.strokeStyle = outline;
    cx.lineWidth = 3 * s;
    cx.fillStyle = justHit ? '#ff5a64' : shade(pal.primary, cid === 'zenith' ? -4 : 16);
    rrs(cx, -torsoW / 2, torsoY - bodyH * 0.06, torsoW, bodyH * 0.5, 8 * s);
    // chest plate accent
    cx.fillStyle = shade(pal.primary, cid === 'zenith' ? 14 : 34);
    rr(cx, -torsoW / 2 + 3 * s, torsoY - bodyH * 0.04, torsoW - 6 * s, bodyH * 0.2, 6 * s);
    // top rim light (GDD: graphic-novel edge lighting)
    cx.strokeStyle = 'rgba(255,240,220,0.28)';
    cx.lineWidth = 1.6 * s;
    cx.beginPath();
    cx.moveTo(-torsoW / 2 + 6 * s, torsoY - bodyH * 0.05);
    cx.lineTo(torsoW / 2 - 6 * s, torsoY - bodyH * 0.05);
    cx.stroke();

    // per-character flourish
    if (cid === 'strigoi') {
      // high collar + crimson lining
      cx.fillStyle = shade(pal.secondary, 22);
      cx.beginPath();
      cx.moveTo(-torsoW * 0.34, torsoY - bodyH * 0.05);
      cx.lineTo(-torsoW * 0.5, torsoY - bodyH * 0.2);
      cx.lineTo(-torsoW * 0.16, torsoY - bodyH * 0.06);
      cx.closePath(); cx.fill();
      cx.beginPath();
      cx.moveTo(torsoW * 0.34, torsoY - bodyH * 0.05);
      cx.lineTo(torsoW * 0.5, torsoY - bodyH * 0.2);
      cx.lineTo(torsoW * 0.16, torsoY - bodyH * 0.06);
      cx.closePath(); cx.fill();
      cx.strokeStyle = pal.accent;
      cx.lineWidth = 1.6 * s;
      cx.beginPath();
      cx.moveTo(0, torsoY - bodyH * 0.04);
      cx.lineTo(0, torsoY + bodyH * 0.4);
      cx.stroke();
    } else if (f.char.character.id === 'graft') {
      cx.strokeStyle = '#1c0d12';
      cx.lineWidth = 1.5 * s;
      for (let k = 0; k < 3; k++) {
        cx.beginPath();
        cx.moveTo(-torsoW / 2 + 4 * s, torsoY + k * bodyH * 0.13 + 6 * s);
        cx.lineTo(torsoW / 2 - 4 * s, torsoY + k * bodyH * 0.13 + 2 * s);
        cx.stroke();
      }
      // mismatched giant shoulder
      cx.fillStyle = shade(pal.secondary, 18);
      cx.beginPath();
      cx.arc(-face * torsoW * 0.42, torsoY, W * 0.34, 0, Math.PI * 2);
      cx.fill();
    } else {
      // ragged mantle
      cx.fillStyle = 'rgba(120,30,30,0.55)';
      cx.beginPath();
      cx.moveTo(-face * torsoW * 0.4, torsoY - 4 * s);
      cx.lineTo(-face * (torsoW * 0.75 + Math.sin(t * 0.1) * 4 * s), torsoY + bodyH * 0.34);
      cx.lineTo(-face * torsoW * 0.28, torsoY + bodyH * 0.3);
      cx.closePath();
      cx.fill();
      // solar debt veins
      if (f.debt > 0) {
        cx.strokeStyle = `rgba(255,217,122,${0.25 + 0.65 * (f.debt / 100)})`;
        cx.lineWidth = 1.3 * s;
        cx.beginPath();
        cx.moveTo(0, torsoY - headR * 0.6);
        cx.lineTo(4 * s * face, torsoY + bodyH * 0.1);
        cx.lineTo(-2 * s * face, torsoY + bodyH * 0.24);
        cx.stroke();
      }
    }

    // arms
    const armW = W * 0.2;
    cx.fillStyle = shade(pal.primary, -12);
    if (guard) {
      // forearms up
      rr(cx, face > 0 ? torsoW * 0.18 : -torsoW * 0.18 - armW, torsoY - bodyH * 0.02, armW, bodyH * 0.3, 4 * s);
      rr(cx, face > 0 ? torsoW * 0.30 : -torsoW * 0.30 - armW, torsoY + bodyH * 0.02, armW, bodyH * 0.26, 4 * s);
      cx.strokeStyle = 'rgba(143,168,200,0.5)';
      cx.lineWidth = 2 * s;
      cx.beginPath();
      cx.arc(face * torsoW * 0.5, torsoY + bodyH * 0.12, W * 0.5, -1.1, 1.1);
      cx.stroke();
    } else if (mv && (useLimb === 'ARMS' || useLimb === 'BODY') && activeK > 0.1) {
      // punch extend + swipe
      const ext = activeK * W * 1.5;
      cx.save();
      cx.translate(face * torsoW * 0.3, torsoY + bodyH * 0.08);
      cx.rotate(face > 0 ? 0 : Math.PI);
      cx.fillStyle = shade(pal.primary, 6);
      rr(cx, 0, -armW / 2, W * 0.6 + ext, armW, 5 * s);
      cx.fillStyle = shade(pal.accent, 0);
      cx.beginPath();
      cx.arc(W * 0.6 + ext, 0, armW * 0.62, 0, Math.PI * 2);
      cx.fill();
      cx.restore();
      if (activeK === 1) {
        cx.strokeStyle = 'rgba(255,255,255,0.5)';
        cx.lineWidth = 3 * s;
        cx.beginPath();
        cx.arc(face * (torsoW * 0.3), torsoY + bodyH * 0.06, W * 1.1 + W * 0.5, face > 0 ? -0.6 : Math.PI - 0.6, face > 0 ? 0.5 : Math.PI + 0.5);
        cx.stroke();
      }
    } else {
      cx.strokeStyle = outline;
      cx.lineWidth = 2.2 * s;
      rrs(cx, -torsoW / 2 - armW * 0.8, torsoY, armW, bodyH * 0.34, 4 * s);
      rrs(cx, torsoW / 2 - armW * 0.2, torsoY, armW, bodyH * 0.34, 4 * s);
    }

    // head — distinct from armor so the silhouette reads
    const headY = torsoY - headR * 0.8;
    const isGraft = cid === 'graft';
    cx.strokeStyle = outline;
    cx.lineWidth = 3 * s;
    cx.fillStyle = justHit ? '#ff6a72' : (isGraft ? '#9a8890' : cid === 'strigoi' ? '#ded6d8' : '#e5d5a8');
    cx.beginPath();
    cx.arc(face * W * 0.06, headY, headR, 0, Math.PI * 2);
    cx.fill();
    cx.stroke();
    if (cid === 'strigoi') {
      // pale to translucency; the eyes are the color of the work
      cx.fillStyle = '#c22a3a';
      cx.beginPath(); cx.arc(face * (W * 0.06 + headR * 0.35), headY - headR * 0.12, headR * 0.12, 0, Math.PI * 2); cx.fill();
      cx.beginPath(); cx.arc(face * (W * 0.06 + headR * 0.02), headY - headR * 0.14, headR * 0.1, 0, Math.PI * 2); cx.fill();
      cx.strokeStyle = 'rgba(143,15,34,0.5)';
      cx.lineWidth = 1 * s;
      cx.beginPath();
      cx.moveTo(face * W * 0.06 - headR * 0.4, headY + headR * 0.5);
      cx.lineTo(face * W * 0.06 - headR * 0.15, headY + headR * 0.1);
      cx.stroke();
    } else if (isGraft) {
      // head stitches + mismatched eyes
      cx.strokeStyle = '#2a1218';
      cx.lineWidth = 1.4 * s;
      cx.beginPath();
      cx.moveTo(face * W * 0.06 - headR * 0.7, headY - headR * 0.3);
      cx.lineTo(face * W * 0.06 + headR * 0.5, headY - headR * 0.55);
      cx.stroke();
      cx.fillStyle = '#d8c95a';
      cx.beginPath(); cx.arc(face * (W * 0.06 + headR * 0.42), headY - headR * 0.1, headR * 0.15, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = '#4a3f45';
      cx.beginPath(); cx.arc(face * (W * 0.06 + headR * 0.05), headY - headR * 0.12, headR * 0.11, 0, Math.PI * 2); cx.fill();
    } else {
      // burned-gold visor slit, eyes smoking faintly at high debt
      cx.fillStyle = '#3a2f1a';
      cx.fillRect(face * W * 0.06 + (face > 0 ? headR * 0.05 : -headR * 0.65), headY - headR * 0.22, headR * 0.6, headR * 0.2);
      cx.fillStyle = f.debt >= 60 ? '#ffd97a' : '#fff1c8';
      cx.fillRect(face * W * 0.06 + (face > 0 ? headR * 0.12 : -headR * 0.58), headY - headR * 0.18, headR * 0.46, headR * 0.12);
    }

    // meat wall aura
    if (f.state === 'stance' && f.stancePhase === 'hold') {
      cx.strokeStyle = `rgba(201,138,74,${0.4 + 0.2 * Math.sin(t * 0.3)})`;
      cx.lineWidth = 3 * s;
      cx.beginPath();
      cx.arc(0, torsoY, W * 1.15, 0, Math.PI * 2);
      cx.stroke();
    }
    // parry stance shimmer
    if (mv && mv.parry) {
      cx.strokeStyle = `rgba(255,217,122,${0.5 + 0.3 * Math.sin(t * 0.5)})`;
      cx.lineWidth = 2.5 * s;
      cx.beginPath();
      cx.arc(face * torsoW * 0.4, torsoY + bodyH * 0.08, W * 0.7, 0, Math.PI * 2);
      cx.stroke();
    }

    // wound overlays per region
    this.wounds(cx, f, { torsoW, bodyH, torsoY, headR, headY, W, s, face, legH, legW });

    // gore paint
    if (gore > 0.02) {
      cx.globalAlpha = gore;
      cx.fillStyle = pal.blood;
      rr(cx, -torsoW / 2, torsoY - bodyH * 0.06, torsoW, bodyH * 0.5, 8 * s);
      cx.globalAlpha = 1;
    }

    // drain flush: drained blood visibly routes through him
    if (this.healFx[f.id] > 0) {
      this.healFx[f.id]--;
      cx.globalAlpha = 0.3 * (this.healFx[f.id] / 22);
      cx.fillStyle = pal.accent || '#b03040';
      rr(cx, -torsoW / 2, torsoY - bodyH * 0.06, torsoW, bodyH * 0.5, 8 * s);
      cx.beginPath();
      cx.arc(face * W * 0.06, headY, headR, 0, Math.PI * 2);
      cx.fill();
      cx.globalAlpha = 1;
    }

    cx.restore();

    // bleeding drips (world-space, after restore)
    if (f.bleedRegions.length > 0 && this.t % 6 === 0 && f.state !== 'ko') {
      this.parts.push({
        type: 'drop', col: pal.blood,
        x: f.x / SCALE + (Math.random() - 0.5) * 30,
        y: 60 + Math.random() * 120,
        vx: (Math.random() - 0.5) * 0.6, vy: -0.5, g: 0.3,
        size: 1.2 + Math.random() * 1.4, life: 80
      });
    }
  }

  wounds(cx, f, m) {
    const woundCol = ws => ws >= 3 ? '#ff2135' : ws === 2 ? '#b3202e' : '#7a1622';
    const mark = (wx, wy, w, h, ws) => {
      if (ws <= 0) return;
      cx.strokeStyle = woundCol(ws);
      cx.lineWidth = (ws >= 2 ? 2.2 : 1.4) * m.s;
      cx.globalAlpha = 0.85;
      for (let k = 0; k < ws; k++) {
        cx.beginPath();
        cx.moveTo(wx + (k * 7 - 4) * m.s, wy);
        cx.lineTo(wx + (k * 7 + 3) * m.s, wy + h);
        cx.stroke();
      }
      cx.globalAlpha = 1;
    };
    const th = f.balanceRef.trauma.thresholds;
    const wsOf = r => f.trauma[r] >= th[2] ? 3 : f.trauma[r] >= th[1] ? 2 : f.trauma[r] >= th[0] ? 1 : 0;
    mark(-m.torsoW * 0.1, m.torsoY + m.bodyH * 0.05, 0, m.bodyH * 0.22, wsOf('BODY'));
    mark(m.face * m.torsoW * 0.42, m.torsoY + m.bodyH * 0.02, 0, m.bodyH * 0.18, wsOf('ARMS'));
    mark(-m.W * 0.2, -m.legH * 0.8, 0, m.legH * 0.5, wsOf('LEGS'));
    mark(m.face * m.W * 0.06, m.headY - m.headR * 0.4, 0, m.headR * 0.7, wsOf('HEAD'));
  }
}

// rounded rect (fill)
function rr(cx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.arcTo(x + w, y, x + w, y + h, r);
  cx.arcTo(x + w, y + h, x, y + h, r);
  cx.arcTo(x, y + h, x, y, r);
  cx.arcTo(x, y, x + w, y, r);
  cx.closePath();
  cx.fill();
}

// rounded rect (fill + outline stroke)
function rrs(cx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.arcTo(x + w, y, x + w, y + h, r);
  cx.arcTo(x + w, y + h, x, y + h, r);
  cx.arcTo(x, y + h, x, y, r);
  cx.arcTo(x, y, x + w, y, r);
  cx.closePath();
  cx.fill();
  cx.stroke();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}
