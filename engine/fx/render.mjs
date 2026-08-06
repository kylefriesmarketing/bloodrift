// World renderer — Canvas 2D. View-only: reads sim state + events, never writes it.
// Math.random is ALLOWED here (render-side only; the sim stays pure).
// Art direction (GDD §11): desaturated world, blood is the brightest thing on screen.
//
// LIFE PASS (2026-08-05): fighters render into an offscreen body canvas and are
// composited with floor reflections + afterimages; pools ripple, track bloody
// footprints, and visibly crawl toward the Rift-scar; the broken moon drifts behind
// burning ruins; ash falls; the camera punches on the big beats. All view-only.

import { SCALE, resolveMove } from '../sim/sim.mjs';
import { drawFigure } from './body.mjs';
import { Post } from './post.mjs';
import { shade, shadeCss, withAlpha, rr, rrs, limb } from './draw2d.mjs';

const VW = 1280, VH = 720, FLOOR_Y = 596;
const FCW = 520, FCH = 560, FOOT_X = 260, FOOT_Y = 500; // offscreen body canvas metrics

export class Renderer {
  constructor(canvas, arena, looks) {
    this.cv = canvas;
    this.vcx = canvas.getContext('2d');
    this.cx = this.vcx;
    this.looksData = looks || { default: { build: { shoulder: 1, waist: 0.7, limb: 1, head: 1, neck: 1 }, skin: '#d8c2a8', parts: [] }, looks: {} };
    // the world renders into a scene buffer so post can bloom/grade/split it
    this.scene = document.createElement('canvas');
    this.scene.width = VW;
    this.scene.height = VH;
    this.scx = this.scene.getContext('2d');
    this.post = new Post(VW, VH);
    this.arena = arena;
    this.camX = arena.width / 2;
    this.camS = 0.9;
    this.S = 0.9;
    this.camPunch = 0;
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.parts = [];
    this.flashT = 0;
    this.flashCol = '#fff';
    this.healFx = [0, 0];
    this.edgeT = 0;
    this.t = 0;
    // persistent gore decals, world-space floor strip
    this.decal = document.createElement('canvas');
    this.decal.width = arena.width;
    this.decal.height = 260;
    this.dcx = this.decal.getContext('2d');
    // offscreen fighter body canvas (rendered per fighter per frame, composited 2-3×)
    this.fcv = document.createElement('canvas');
    this.fcv.width = FCW;
    this.fcv.height = FCH;
    this.fcx = this.fcv.getContext('2d');
    this.trail = [[], []];        // recent world positions for afterimages
    this.wet = [0, 0];            // bloody-footprint steps remaining
    this.stepT = [0, 0];
    this.rippleT = [0, 0];
    // film grain tile
    this.grain = document.createElement('canvas');
    this.grain.width = 256;
    this.grain.height = 256;
    const g = this.grain.getContext('2d');
    const im = g.createImageData(256, 256);
    for (let i = 0; i < im.data.length; i += 4) {
      const v = 120 + (Math.random() * 90) | 0;
      im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v;
      im.data[i + 3] = Math.random() < 0.5 ? 10 : 0;
    }
    g.putImageData(im, 0, 0);
    this.displayHp = [1, 1];
    this.abT = 0;
  }

  lookFor(f) {
    const id = f.char.character.id;
    const d = this.looksData;
    const base = d.default || {};
    const l = (d.looks || {})[id] || {};
    return {
      build: Object.assign({}, base.build, l.build),
      skin: l.skin || base.skin || '#d8c2a8',
      parts: l.parts || base.parts || [],
      beastBuild: l.beastBuild
    };
  }

  reset() {
    this.dcx.clearRect(0, 0, this.decal.width, this.decal.height);
    this.parts = [];
    this.shakeT = 0;
    this.flashT = 0;
    this.boneT = 0;
    this.execT = 0;
    this.edgeT = 0;
    this.camPunch = 0;
    this.healFx = [0, 0];
    this.trail = [[], []];
    this.wet = [0, 0];
    this.displayHp = [1, 1];
  }

  // ---- events → fx
  consume(sim, evs) {
    for (const e of evs) {
      switch (e.t) {
        case 'hit': case 'grabHit': {
          const vic = sim.fighters[e.who];
          const hx = e.x ?? vic.x / SCALE, hy = e.y ?? 130;
          const dmg = e.dmg || 20;
          const kind = e.kind || (e.t === 'grabHit' ? 'grab' : 'punch');
          const dir = e.dir || 1;
          this.impact(hx, hy, dmg, kind, dir);
          this.shake(Math.min(13, 3 + dmg / 14));
          if (dmg >= 60) {
            this.punch(0.05);
            for (let k = 0; k < 3; k++) {
              this.parts.push({
                type: 'mist', x: hx + (Math.random() - 0.5) * 30, y: hy + (Math.random() - 0.5) * 30,
                vx: (Math.random() - 0.5) * 0.6, vy: 0.5 + Math.random() * 0.5,
                r: 16 + Math.random() * 18, life: 34, max: 34
              });
            }
          }
          if (e.counter) this.flash('#ffd97a', 5);
          if ((e.combo || 0) >= 4) this.edgeT = 16;
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
        case 'land': {
          const f = sim.fighters[e.who];
          this.dust(f.x / SCALE, e.hard ? 9 : 5);
          if (e.hard) this.shake(6);
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
        case 'overdrive': this.flash('#ff2135', 12); this.punch(0.09); break;
        case 'breaker': this.flash('#8fd8ff', 6); break;
        case 'roundEnd': this.flash('#ff2135', 10); this.shake(15); this.punch(0.07); break;
        case 'flare': this.flash('#ffd97a', 3); break;
        case 'sunder': {
          this.flash('#ff2135', 10);
          this.shake(17);
          this.punch(0.12);
          this.boneT = 52;
          this.boneWho = e.who;
          this.boneRegion = e.region;
          break;
        }
        case 'execution': {
          this.flash('#ff2135', 14);
          this.shake(19);
          this.punch(0.14);
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
      }
    }
  }

  shake(amp) { this.shakeT = 14; this.shakeAmp = Math.max(this.shakeAmp, amp); }
  flash(col, t) { this.flashT = Math.max(this.flashT, t); this.flashCol = col; }
  punch(k) {
    this.camPunch = Math.max(this.camPunch, k);
    if (k >= 0.09) this.abT = Math.max(this.abT, 11); // sunders, overdrives, executions
  }

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

  // training-mode box view: blue hurtboxes, red active hitboxes, yellow pushboxes
  drawBoxes(cx, sim, W2S, Y2S, S) {
    const box = (wx, wy, w, h, stroke, fill) => {
      const x = W2S(wx), y = Y2S(wy + h);
      cx.fillStyle = fill;
      cx.fillRect(x, y, w * S, h * S);
      cx.strokeStyle = stroke;
      cx.lineWidth = 1.5;
      cx.strokeRect(x, y, w * S, h * S);
    };
    for (const f of sim.fighters) {
      const fx = f.x / SCALE, fy = f.y / SCALE;
      // pushbox
      box(fx - f.stats.width / 2, fy, f.stats.width, f.stats.height, 'rgba(255,214,90,0.7)', 'rgba(255,214,90,0.05)');
      // hurtboxes
      for (const b of sim.hurtboxesOf(f)) {
        const bx = fx + f.facing * b.x - (f.facing < 0 ? b.w : 0);
        box(bx, fy + b.y, b.w, b.h, 'rgba(90,170,255,0.85)', 'rgba(90,170,255,0.16)');
      }
      // active hitboxes
      if (f.state === 'move' && f.moveId && !f.hitDone) {
        const mv = resolveMove(f.char, f.moveId, f.moveVar);
        const fr = mv.frames;
        const rel = f.moveF - fr.startup;
        if (mv.hitboxes && rel >= 1 && rel <= fr.active) {
          for (const hb of mv.hitboxes) {
            if (rel < hb.frames[0] || rel > hb.frames[1]) continue;
            const bx = mv.atOpponent
              ? sim.fighters[1 - f.id].x / SCALE + hb.x
              : fx + f.facing * hb.x - (f.facing < 0 ? hb.w : 0);
            box(bx, hb.y, hb.w, hb.h, 'rgba(255,60,80,0.95)', 'rgba(255,60,80,0.26)');
          }
        }
      }
    }
    for (const p of sim.projectiles) {
      box(p.x / SCALE - p.w / 2, p.y / SCALE - p.h / 2, p.w, p.h, 'rgba(255,120,60,0.9)', 'rgba(255,120,60,0.22)');
    }
  }

  // an impact reads differently depending on what hit you — this is most of "feel"
  impact(wx, wy, dmg, kind, dir) {
    const heavy = Math.min(1, dmg / 90);
    if (kind === 'kick') {
      // wide arcing crescent along the swing
      this.parts.push({ type: 'crescent', x: wx, y: wy, a: dir > 0 ? -0.5 : Math.PI + 0.5, dir,
        r: 26 + heavy * 34, life: 11, max: 11, col: '#fff2d8' });
      this.spark(wx, wy, '#ffe6c0', 7 + heavy * 8);
    } else if (kind === 'proj') {
      // radial burst — energy dumping into a body
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.random() * 0.4;
        this.parts.push({ type: 'shard', x: wx, y: wy, vx: Math.cos(a) * (2 + heavy * 4),
          vy: Math.sin(a) * (2 + heavy * 4), life: 13, max: 13, col: '#ffd08a' });
      }
      this.spark(wx, wy, '#ffca7a', 9 + heavy * 10);
    } else if (kind === 'grab') {
      // compression: rings collapsing inward, no spray
      for (let k = 0; k < 3; k++) {
        this.parts.push({ type: 'implode', x: wx, y: wy - 10 + k * 14, r: 46 - k * 8, life: 15, max: 15, col: '#c2444e' });
      }
    } else if (kind === 'super') {
      this.parts.push({ type: 'crescent', x: wx, y: wy, a: dir > 0 ? -0.7 : Math.PI + 0.7, dir,
        r: 70, life: 16, max: 16, col: '#ffffff' });
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        this.parts.push({ type: 'shard', x: wx, y: wy, vx: Math.cos(a) * 7, vy: Math.sin(a) * 7,
          life: 18, max: 18, col: '#ff8a94' });
      }
      this.spark(wx, wy, '#fff', 22);
    } else {
      // punch: tight star, straight impact lines along the blow
      this.spark(wx, wy, '#fff', 8 + heavy * 10);
      for (let k = 0; k < 3; k++) {
        this.parts.push({ type: 'shard', x: wx, y: wy,
          vx: dir * (3 + Math.random() * 5 + heavy * 3), vy: (Math.random() - 0.5) * 3.5,
          life: 10, max: 10, col: '#ffffff' });
      }
    }
  }

  dust(wx, n) {
    for (let k = 0; k < n; k++) {
      this.parts.push({
        type: 'dust', x: wx + (Math.random() - 0.5) * 40, y: 4 + Math.random() * 8,
        vx: (Math.random() - 0.5) * 1.6, vy: 0.5 + Math.random() * 0.8,
        r: 5 + Math.random() * 7, life: 26, max: 26
      });
    }
  }

  // ---- frame
  draw(sim) {
    this.t++;
    this.cx = this.scx;          // the world paints into the scene buffer
    const cx = this.cx;
    const [a, b] = sim.fighters;
    // camera
    const mid = (a.x + b.x) / 2 / SCALE;
    const dist = Math.abs(a.x - b.x) / SCALE;
    const targS = Math.max(0.68, Math.min(1.16, 1320 / (dist + 520)));
    this.camS += (targS - this.camS) * 0.06;
    this.camPunch *= 0.88;
    if (this.camPunch < 0.003) this.camPunch = 0;
    this.S = this.camS * (1 + this.camPunch);
    const S = this.S;
    const half = VW / 2 / S;
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

    const W2S = wx => (wx - this.camX) * S + VW / 2 + sx;
    const Y2S = wy => FLOOR_Y - wy * S + sy;
    this.W2S = W2S; this.Y2S = Y2S;

    // ---------- sky
    const look = this.arena.look || {};
    const g = cx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#07060a');
    g.addColorStop(0.55, look.sky || '#0b0a10');
    g.addColorStop(1, '#151015');
    cx.fillStyle = g;
    cx.fillRect(0, 0, VW, VH);

    // the moon is wrong (GDD §2) — cracked, red at the seam, drifting very slowly
    {
      const mx = ((this.t * 0.02) % (VW + 500)) - 250 + 900 - this.camX * 0.05;
      const my = 120 + Math.sin(this.t * 0.001) * 6;
      const mr = 58;
      cx.save();
      cx.globalAlpha = 0.5;
      const mg = cx.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 1.9);
      mg.addColorStop(0, 'rgba(216,208,196,0.5)');
      mg.addColorStop(0.5, 'rgba(216,208,196,0.08)');
      mg.addColorStop(1, 'rgba(216,208,196,0)');
      cx.fillStyle = mg;
      cx.fillRect(mx - mr * 2, my - mr * 2, mr * 4, mr * 4);
      cx.globalAlpha = 0.62;
      cx.fillStyle = '#cfc8ba';
      cx.beginPath(); cx.arc(mx, my, mr, 0, Math.PI * 2); cx.fill();
      // the crack — a hairline of Rift-red across the face
      cx.strokeStyle = 'rgba(120,40,44,0.85)';
      cx.lineWidth = 2;
      cx.beginPath();
      cx.moveTo(mx - mr * 0.7, my - mr * 0.5);
      cx.lineTo(mx - mr * 0.2, my - mr * 0.05);
      cx.lineTo(mx + mr * 0.15, my + mr * 0.12);
      cx.lineTo(mx + mr * 0.55, my + mr * 0.62);
      cx.stroke();
      cx.strokeStyle = `rgba(255,33,53,${0.25 + 0.15 * Math.sin(this.t * 0.03)})`;
      cx.lineWidth = 1;
      cx.stroke();
      // a sliver of the far half is simply missing
      cx.globalCompositeOperation = 'destination-out';
      cx.beginPath();
      cx.ellipse(mx + mr * 0.85, my - mr * 0.4, mr * 0.45, mr * 0.8, 0.5, 0, Math.PI * 2);
      cx.fill();
      cx.globalCompositeOperation = 'source-over';
      cx.restore();
    }

    // god-rays — faint shafts through the ruined roofline
    for (let r = 0; r < 3; r++) {
      const rx = ((r * 430 + 160) - this.camX * 0.12 * S + VW) % (VW + 300) - 150;
      const sway = Math.sin(this.t * 0.006 + r * 2) * 30;
      const rg = cx.createLinearGradient(rx, 0, rx + sway, FLOOR_Y);
      rg.addColorStop(0, 'rgba(210,190,190,0.045)');
      rg.addColorStop(1, 'rgba(210,190,190,0)');
      cx.fillStyle = rg;
      cx.beginPath();
      cx.moveTo(rx - 30, -10);
      cx.lineTo(rx + 60, -10);
      cx.lineTo(rx + 200 + sway, FLOOR_Y);
      cx.lineTo(rx - 140 + sway, FLOOR_Y);
      cx.closePath();
      cx.fill();
    }

    // ---------- ruins bands (parallax) with distant fires
    const bands = look.bands || ['#141019', '#100d14'];
    bands.forEach((col, bi) => {
      const par = 0.2 + bi * 0.16;
      cx.fillStyle = col;
      const off = -this.camX * par * S;
      for (let i = -1; i < 6; i++) {
        const bx = ((i * 420 + off) % (VW + 420) + VW + 420) % (VW + 420) - 420;
        const h = 150 + ((i * 73 + bi * 131) % 120);
        const bw = 200 + (i * 37 % 90);
        const by = FLOOR_Y - h - 60 - bi * 40;
        cx.fillStyle = col;
        cx.fillRect(bx, by, bw, h + 200);
        // something still burns in the far windows
        if ((i * 7 + bi * 13) % 3 === 0) {
          const fx = bx + ((i * 53 + bi * 29) % (bw - 30)) + 12;
          const fy = by + 30 + ((i * 91) % (h - 50));
          const flick = 0.25 + Math.random() * 0.3;
          cx.fillStyle = `rgba(255,120,40,${flick * (0.5 - bi * 0.15)})`;
          cx.fillRect(fx, fy, 7, 10);
          if ((i + bi) % 2 === 0) cx.fillRect(fx + 16, fy + 22, 5, 8);
        }
      }
      // atmospheric haze between layers — the classic depth cue, kept light
      const hz = cx.createLinearGradient(0, FLOOR_Y - 420, 0, FLOOR_Y + 30);
      hz.addColorStop(0, `rgba(64,54,74,${0.05 + bi * 0.01})`);
      hz.addColorStop(1, `rgba(44,34,50,${0.11 + bi * 0.02})`);
      cx.fillStyle = hz;
      cx.fillRect(0, FLOOR_Y - 420, VW, 452);
    });

    // drifting fog banks across the mid-ground
    for (let fg = 0; fg < 3; fg++) {
      const fx2 = ((this.t * (0.14 + fg * 0.06) + fg * 520) % (VW + 700)) - 350 - this.camX * 0.18 * S % 400;
      const fy2 = FLOOR_Y - 60 - fg * 42;
      const fgr = cx.createRadialGradient(fx2, fy2, 10, fx2, fy2, 260);
      fgr.addColorStop(0, `rgba(120,100,120,${0.055 - fg * 0.012})`);
      fgr.addColorStop(1, 'rgba(120,100,120,0)');
      cx.fillStyle = fgr;
      cx.fillRect(fx2 - 270, fy2 - 130, 540, 260);
    }

    // ---------- the Rift-scar — pulse swells with the blood banked near it
    const scarX = W2S(this.arena.scarX);
    let nearVol = 0;
    for (const p of sim.pools) if (Math.abs(p.x - this.arena.scarX * SCALE) < 400 * SCALE) nearVol += p.vol;
    const feed = Math.min(0.5, nearVol / 900);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * (0.05 + feed * 0.05));
    const sg = cx.createLinearGradient(scarX, FLOOR_Y - 320, scarX, FLOOR_Y + 40);
    sg.addColorStop(0, 'rgba(255,33,53,0)');
    sg.addColorStop(0.7, `rgba(255,33,53,${0.16 + pulse * (0.12 + feed * 0.2)})`);
    sg.addColorStop(1, `rgba(255,33,53,${0.30 + pulse * (0.14 + feed * 0.2)})`);
    cx.fillStyle = sg;
    cx.fillRect(scarX - 60 - feed * 40, FLOOR_Y - 320, 120 + feed * 80, 360);
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
    // falling ash — the world burning somewhere off-screen
    if (this.t % 7 === 0) {
      this.parts.push({
        type: 'ash', x: this.camX + (Math.random() - 0.5) * (VW / S + 200), y: 620 + Math.random() * 60,
        vx: 0.2 + Math.random() * 0.3, vy: 0.55 + Math.random() * 0.5,
        ph: Math.random() * 6.28, size: 1 + Math.random() * 1.8, life: 900
      });
    }

    // ---------- floor
    cx.fillStyle = look.ground || '#181419';
    cx.fillRect(0, FLOOR_Y, VW, VH - FLOOR_Y);
    cx.fillStyle = look.groundEdge || '#241d22';
    cx.fillRect(0, FLOOR_Y, VW, 4);
    cx.strokeStyle = 'rgba(0,0,0,0.35)';
    cx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const fx = W2S(i * 220);
      cx.beginPath(); cx.moveTo(fx, FLOOR_Y); cx.lineTo(fx - 60, VH); cx.stroke();
    }

    // gore decals
    cx.save();
    cx.translate(W2S(0), FLOOR_Y - 30 * S);
    cx.scale(S, S);
    cx.globalAlpha = 0.92;
    cx.drawImage(this.decal, 0, 0);
    cx.restore();

    // ---------- pools + their crawl toward the scar (or the loser, at the end)
    const finishing = sim.phase === 'finish';
    const loserF = finishing ? sim.fighters[1 - sim.roundWinner] : null;
    for (const p of sim.pools) {
      const px = W2S(p.x / SCALE), pr = p.r * S;
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
      // the crawl: thin wavering threads reaching where the blood wants to go
      const targX2 = finishing && loserF ? W2S(loserF.x / SCALE) : W2S(this.arena.scarX);
      const dirC = Math.sign(targX2 - px) || 1;
      const reach = Math.min(60, Math.abs(targX2 - px) * 0.25) * (finishing ? 1.5 : 1);
      if (reach > 8) {
        cx.strokeStyle = `rgba(160,18,34,${finishing ? 0.5 + pulse * 0.3 : 0.3})`;
        cx.lineWidth = finishing ? 2 : 1.3;
        for (let th = 0; th < 2; th++) {
          cx.beginPath();
          cx.moveTo(px + dirC * pr * 0.8, FLOOR_Y + 15 + th * 4);
          const wob = Math.sin(this.t * 0.08 + p.x + th * 3) * 3;
          cx.quadraticCurveTo(
            px + dirC * (pr * 0.8 + reach * 0.5), FLOOR_Y + 13 + th * 5 + wob,
            px + dirC * (pr * 0.8 + reach), FLOOR_Y + 15 + th * 3);
          cx.stroke();
        }
      }
    }

    // ---------- fighters (offscreen body → ghosts + reflection + main)
    const order = a.x <= b.x ? [a, b] : [b, a];
    for (const f of order) this.compositeFighter(cx, sim, f);

    // ---------- projectiles
    for (const p of sim.projectiles) {
      const px = W2S(p.x / SCALE), py = Y2S(p.y / SCALE);
      const isFlare = p.variant === 'flare';
      if (p.moveId === 'sunlance') {
        const col = isFlare ? '#ffd97a' : '#ffc44a';
        const grad = cx.createLinearGradient(px - 40 * Math.sign(p.vx), py, px + 20 * Math.sign(p.vx), py);
        grad.addColorStop(0, 'rgba(255,150,60,0)');
        grad.addColorStop(1, col);
        cx.fillStyle = grad;
        cx.beginPath();
        cx.ellipse(px, py, (p.w / 2 + 14) * S, (p.h / 2 + 4) * S, 0, 0, Math.PI * 2);
        cx.fill();
        cx.fillStyle = '#fff7dd';
        cx.beginPath();
        cx.ellipse(px, py, p.w / 2 * S * 0.7, p.h / 2 * S * 0.7, 0, 0, Math.PI * 2);
        cx.fill();
        // heat shimmer trail
        cx.fillStyle = 'rgba(255,150,60,0.12)';
        cx.beginPath();
        cx.ellipse(px - Math.sign(p.vx) * 34 * S, py, 26 * S, 7 * S, 0, 0, Math.PI * 2);
        cx.fill();
      } else {
        cx.save();
        cx.translate(px, py);
        cx.rotate(this.t * 0.4 * Math.sign(p.vx));
        cx.fillStyle = '#8a8f98';
        cx.fillRect(-p.w / 2 * S, -p.h / 2 * S, p.w * S, p.h * S);
        cx.strokeStyle = '#3a3f46';
        cx.strokeRect(-p.w / 2 * S, -p.h / 2 * S, p.w * S, p.h * S);
        cx.restore();
      }
    }

    // ---------- hitbox / hurtbox view (THE MORGUE)
    if (this.debugBoxes) this.drawBoxes(cx, sim, W2S, Y2S, S);

    // ---------- particles
    this.parts = this.parts.filter(p => { p.life--; return p.life > 0; });
    for (const p of this.parts) {
      if (p.type === 'drop') {
        p.vy += p.g ? -p.g : 0;
        p.x += p.vx; p.y += p.vy;
        if (p.y <= 2) {
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
        // motion-stretched droplet
        const st = Math.min(2.1, Math.abs(p.vy) * 0.32 + 0.8);
        cx.globalAlpha = 0.9;
        cx.beginPath();
        cx.ellipse(W2S(p.x), Y2S(p.y), p.size * 0.7 * S, p.size * 0.7 * st * S, 0, 0, Math.PI * 2);
        cx.fill();
        cx.globalAlpha = 1;
      } else if (p.type === 'ember') {
        p.x += p.vx; p.y -= p.vy;
        cx.globalAlpha = Math.min(1, p.life / 60) * 0.8;
        cx.fillStyle = p.col;
        cx.fillRect(W2S(p.x), Y2S(p.y), 2, 2);
        cx.globalAlpha = 1;
      } else if (p.type === 'ash') {
        p.ph += 0.02;
        p.x += p.vx + Math.sin(p.ph) * 0.3;
        p.y -= p.vy;
        if (p.y <= 0) { p.life = 0; continue; }
        cx.globalAlpha = 0.25;
        cx.fillStyle = '#9a9088';
        cx.fillRect(W2S(p.x), Y2S(p.y), p.size, p.size);
        cx.globalAlpha = 1;
      } else if (p.type === 'mist') {
        p.x += p.vx; p.y += p.vy;
        const k = p.life / p.max;
        cx.globalAlpha = 0.10 * k;
        cx.fillStyle = '#c2444e';
        cx.beginPath();
        cx.arc(W2S(p.x), Y2S(p.y), p.r * (2 - k) * S, 0, Math.PI * 2);
        cx.fill();
        cx.globalAlpha = 1;
      } else if (p.type === 'dust') {
        p.x += p.vx; p.y += p.vy * 0.4;
        const k = p.life / p.max;
        cx.globalAlpha = 0.20 * k;
        cx.fillStyle = '#5a5048';
        cx.beginPath();
        cx.arc(W2S(p.x), Y2S(p.y), p.r * (1.6 - k) * S, 0, Math.PI * 2);
        cx.fill();
        cx.globalAlpha = 1;
      } else if (p.type === 'spark') {
        const k = p.life / p.max;
        cx.strokeStyle = p.col;
        cx.globalAlpha = k;
        cx.lineWidth = 2.5;
        cx.beginPath();
        cx.arc(W2S(p.x), Y2S(p.y), p.r * (1.6 - k) * 1.25 * S, 0, Math.PI * 2);
        cx.stroke();
        cx.globalAlpha = 1;
      } else if (p.type === 'crescent') {
        // a swung arc that widens and fades — sells kicks and supers
        const k = p.life / p.max;
        cx.strokeStyle = p.col;
        cx.globalAlpha = k * 0.9;
        cx.lineWidth = (2 + 7 * k) * S;
        cx.beginPath();
        cx.arc(W2S(p.x), Y2S(p.y), p.r * (1.5 - k * 0.5) * S,
          p.a - 0.95 * (1.3 - k), p.a + 0.95 * (1.3 - k));
        cx.stroke();
        cx.globalAlpha = 1;
      } else if (p.type === 'shard') {
        // a hard streak flying off the point of contact
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.9; p.vy *= 0.9;
        const k = p.life / p.max;
        cx.strokeStyle = p.col;
        cx.globalAlpha = k;
        cx.lineWidth = 2.4 * S;
        cx.beginPath();
        cx.moveTo(W2S(p.x), Y2S(p.y));
        cx.lineTo(W2S(p.x - p.vx * 2.2), Y2S(p.y - p.vy * 2.2));
        cx.stroke();
        cx.globalAlpha = 1;
      } else if (p.type === 'implode') {
        // rings collapsing inward — the sound of something being squeezed
        const k = p.life / p.max;
        cx.strokeStyle = p.col;
        cx.globalAlpha = (1 - k) * 0.7;
        cx.lineWidth = 3 * S;
        cx.beginPath();
        cx.arc(W2S(p.x), Y2S(p.y), p.r * k * S, 0, Math.PI * 2);
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

    // sunder bone-cam overlay
    if (this.boneT > 0) {
      this.boneT--;
      const f = sim.fighters[this.boneWho];
      const bx = W2S(f.x / SCALE), byc = Y2S(f.y / SCALE) - 120 * S;
      const k = this.boneT / 52;
      cx.globalAlpha = Math.min(0.85, k * 1.4);
      const rg = cx.createRadialGradient(bx, byc, 8, bx, byc, 170 * S);
      rg.addColorStop(0, 'rgba(255,33,53,0.55)');
      rg.addColorStop(1, 'rgba(255,33,53,0)');
      cx.fillStyle = rg;
      cx.fillRect(bx - 180, byc - 180, 360, 360);
      cx.strokeStyle = this.boneT % 4 < 2 ? '#ffffff' : '#ffd9d9';
      cx.lineWidth = 3 * S;
      cx.beginPath();
      cx.moveTo(bx, byc - 70 * S); cx.lineTo(bx, byc + 60 * S);
      for (let r = 0; r < 4; r++) {
        cx.moveTo(bx - 26 * S, byc - 40 * S + r * 16 * S);
        cx.lineTo(bx + 26 * S, byc - 40 * S + r * 16 * S);
      }
      cx.moveTo(bx, byc - 46 * S); cx.lineTo(bx - 52 * S, byc + 6 * S);
      cx.moveTo(bx, byc - 46 * S); cx.lineTo(bx + 52 * S, byc + 6 * S);
      cx.moveTo(bx, byc + 60 * S); cx.lineTo(bx - 30 * S, byc + 128 * S);
      cx.moveTo(bx, byc + 60 * S); cx.lineTo(bx + 30 * S, byc + 128 * S);
      cx.stroke();
      cx.strokeStyle = '#ff2135';
      cx.lineWidth = 4 * S;
      const ry = this.boneRegion === 'HEAD' ? -84 : this.boneRegion === 'ARMS' ? -20 : this.boneRegion === 'BODY' ? -10 : 96;
      const rx = this.boneRegion === 'ARMS' ? -40 : this.boneRegion === 'LEGS' ? -18 : 0;
      cx.beginPath();
      cx.moveTo(bx + (rx - 16) * S, byc + ry * S);
      cx.lineTo(bx + (rx - 2) * S, byc + (ry + 8) * S);
      cx.lineTo(bx + (rx + 4) * S, byc + (ry - 6) * S);
      cx.lineTo(bx + (rx + 18) * S, byc + (ry + 4) * S);
      cx.stroke();
      cx.globalAlpha = 1;
    }

    // FEED THE RIFT: dim + hungry pools
    if (finishing) {
      cx.fillStyle = 'rgba(4,2,6,0.42)';
      cx.fillRect(0, 0, VW, VH);
      const pulse2 = 0.5 + 0.5 * Math.sin(this.t * 0.11);
      for (const p of sim.pools) {
        const px = W2S(p.x / SCALE), pr = p.r * S;
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

    // vignette
    const vg = cx.createRadialGradient(VW / 2, VH / 2, VH / 2.4, VW / 2, VH / 2, VH);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    cx.fillStyle = vg;
    cx.fillRect(0, 0, VW, VH);
    // combo edge-pulse — the frame itself flushes
    if (this.edgeT > 0) {
      this.edgeT--;
      const eg = cx.createRadialGradient(VW / 2, VH / 2, VH / 2.1, VW / 2, VH / 2, VH * 0.95);
      eg.addColorStop(0, 'rgba(255,33,53,0)');
      eg.addColorStop(1, `rgba(255,33,53,${0.06 * this.edgeT})`);
      cx.fillStyle = eg;
      cx.fillRect(0, 0, VW, VH);
    }

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
        // speed lines converging on the caster
        cx.strokeStyle = 'rgba(255,255,255,0.10)';
        cx.lineWidth = 2;
        for (let l = 0; l < 10; l++) {
          const a2 = (l / 10) * Math.PI * 2 + this.t * 0.05;
          cx.beginPath();
          cx.moveTo(fx + Math.cos(a2) * 620, FLOOR_Y - 120 + Math.sin(a2) * 420);
          cx.lineTo(fx + Math.cos(a2) * 260, FLOOR_Y - 120 + Math.sin(a2) * 180);
          cx.stroke();
        }
      }
    }

    // screen flash
    if (this.flashT > 0) {
      this.flashT--;
      cx.globalAlpha = Math.min(0.5, 0.055 * this.flashT);
      cx.fillStyle = this.flashCol;
      cx.fillRect(0, 0, VW, VH);
      cx.globalAlpha = 1;
    }

    // ---------- composite: bloom, grade, chromatic split
    this.cx = this.vcx;
    const out = this.vcx;
    if (this.abT > 0) this.abT--;
    this.post.apply(this.scene, out, {
      bloom: 0.42,
      // only the heaviest beats split the channels, and only for a few frames
      aberration: this.abT > 6 ? (this.abT - 6) * 0.62 : 0
    });

    // film grain — after post so it stays crisp instead of blooming
    out.globalAlpha = 0.42;
    const gx = (Math.random() * 256) | 0, gy = (Math.random() * 256) | 0;
    for (let ty = -gy; ty < VH; ty += 256) {
      for (let tx = -gx; tx < VW; tx += 256) {
        out.drawImage(this.grain, tx, ty);
      }
    }
    out.globalAlpha = 1;
  }

  // ---------- fighter compositing: body offscreen → ghosts + reflection + main
  compositeFighter(cx, sim, f) {
    const S = this.S;
    const x = this.W2S(f.x / SCALE);
    const yFeet = this.Y2S(f.y / SCALE);
    const lying = f.state === 'kd' || f.state === 'ko';
    const lean = this.leanOf(f);

    // life bookkeeping: bloody footprints + pool ripples + dash dust
    this.lifeTick(sim, f);

    // shadow — shrinks and fades with height
    const hK = Math.max(0, 1 - (f.y / SCALE) / 260);
    cx.fillStyle = `rgba(0,0,0,${0.5 * (0.35 + 0.65 * hK)})`;
    cx.beginPath();
    cx.ellipse(x, this.Y2S(0) + 10, f.stats.width * 0.9 * S * (0.5 + 0.5 * hK), 7 * S * hK + 2, 0, 0, Math.PI * 2);
    cx.fill();

    // render the body once
    this.renderBody(sim, f);

    // position trail for afterimages
    const tr = this.trail[f.id];
    tr.unshift({ x, y: yFeet, rot: lying ? -Math.PI / 2 * f.facing * 0.94 : lean });
    if (tr.length > 7) tr.pop();

    const blit = (px, py, rot, alpha, tint) => {
      cx.save();
      cx.globalAlpha = alpha;
      cx.translate(px, py);
      cx.rotate(rot);
      cx.scale(S, S);
      if (tint) {
        cx.filter = 'brightness(0.6) saturate(2)';
      }
      cx.drawImage(this.fcv, -FOOT_X, -FOOT_Y);
      cx.filter = 'none';
      cx.restore();
    };

    // afterimages during dashes and active attack frames
    let ghosting = f.state === 'dashF' || f.state === 'dashB';
    if (f.state === 'move' && f.moveId) {
      const mv = resolveMove(f.char, f.moveId, f.moveVar);
      const rel = f.moveF - mv.frames.startup;
      if (rel >= 0 && rel <= mv.frames.active + 2) ghosting = true;
    }
    if (ghosting) {
      if (tr[4]) blit(tr[4].x, tr[4].y, tr[4].rot, 0.10);
      if (tr[2]) blit(tr[2].x, tr[2].y, tr[2].rot, 0.20);
    }

    // floor reflection — the arena is polished with old blood
    cx.save();
    cx.globalAlpha = 0.08;
    cx.translate(x, this.Y2S(0) + 12);
    cx.scale(S, -S * 0.5);
    cx.rotate(lying ? Math.PI / 2 * f.facing * 0.94 : -lean * 0.6);
    cx.drawImage(this.fcv, -FOOT_X, -FOOT_Y + (f.y / SCALE) * 2);
    cx.restore();

    // the body itself
    blit(x, yFeet, lying ? -Math.PI / 2 * f.facing * 0.94 : lean, 1);

    // rift rim-light: the wound in reality paints one edge of everything
    const scarSide = Math.sign(this.arena.scarX * SCALE - f.x) || 1;
    const rot = lying ? -Math.PI / 2 * f.facing * 0.94 : lean;
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    cx.globalAlpha = 0.2;
    cx.filter = 'sepia(1) saturate(7) hue-rotate(-38deg) brightness(0.85)';
    cx.translate(x + scarSide * 2.5, yFeet - 1);
    cx.rotate(rot);
    cx.scale(S, S);
    cx.drawImage(this.fcv, -FOOT_X, -FOOT_Y);
    cx.restore();
    cx.filter = 'none';
    cx.globalCompositeOperation = 'source-over';
    cx.globalAlpha = 1;
  }

  leanOf(f) {
    switch (f.state) {
      case 'walkF': return 0.05 * f.facing;
      case 'walkB': return -0.04 * f.facing;
      case 'dashF': return 0.16 * f.facing;
      case 'dashB': return -0.13 * f.facing;
      case 'air': return 0.08 * f.facing;
      case 'hitstun': return -0.22 * f.facing;
      case 'blockstun': return -0.06 * f.facing;
      case 'launched': return Math.max(-1.4, Math.min(1.4, -f.vy / 9000)) * f.facing;
      case 'grabbing': return 0.12 * f.facing;
      case 'grabbed': case 'thrown': return -0.15 * f.facing;
      case 'move': return 0.1 * f.facing * 0.6;
      default: return 0;
    }
  }

  lifeTick(sim, f) {
    // wading through blood: ripples + wet feet
    let inPool = false;
    if (f.y <= 0) {
      for (const p of sim.pools) {
        if (Math.abs(f.x - p.x) <= p.r * SCALE) { inPool = true; break; }
      }
    }
    const moving = f.state === 'walkF' || f.state === 'walkB' || f.state === 'dashF' || f.state === 'dashB';
    if (inPool) {
      this.wet[f.id] = 12; // steps of bloody footprints once he leaves
      if (moving && this.t % 10 === 0) {
        this.parts.push({ type: 'spark', x: f.x / SCALE, y: 6, col: 'rgba(160,18,34,0.6)', r: 5, life: 9, max: 9 });
      }
    } else if (this.wet[f.id] > 0 && moving) {
      this.stepT[f.id]++;
      if (this.stepT[f.id] % 9 === 0) {
        this.wet[f.id]--;
        const d = this.dcx;
        const side = this.wet[f.id] % 2 === 0 ? -10 : 10;
        d.fillStyle = f.char.character.palette.blood;
        d.globalAlpha = 0.10 + 0.03 * this.wet[f.id];
        d.beginPath();
        d.ellipse(f.x / SCALE + side, 46 + Math.random() * 6, 7, 3.2, 0, 0, Math.PI * 2);
        d.fill();
        d.globalAlpha = 1;
      }
    }
    // dash kick-dust
    if ((f.state === 'dashF' || f.state === 'dashB') && f.stateT === 1) this.dust(f.x / SCALE, 4);
  }

  // ---------- one fighter body, drawn at scale 1 into the offscreen canvas
  // ---------- one fighter, drawn at scale 1 into the offscreen canvas.
  // The figure itself lives in body.mjs and is driven entirely by data/looks.json.
  renderBody(sim, f) {
    const cx = this.fcx;
    cx.clearRect(0, 0, FCW, FCH);
    cx.save();
    cx.translate(FOOT_X, FOOT_Y);
    const look = this.lookFor(f);
    // LYCAON (and any future shifter) carries a second build for its beast set
    const useLook = (look.beastBuild && f.gset === 'finesse')
      ? { ...look, build: { ...look.build, ...look.beastBuild } }
      : look;
    drawFigure(cx, sim, f, useLook, this.t, this.healFx);
    cx.restore();

    // bleeding drips into the world
    if (f.bleedRegions.length > 0 && this.t % 6 === 0 && f.state !== 'ko') {
      this.parts.push({
        type: 'drop', col: f.char.character.palette.blood,
        x: f.x / SCALE + (Math.random() - 0.5) * 30,
        y: 60 + Math.random() * 120,
        vx: (Math.random() - 0.5) * 0.6, vy: -0.5, g: 0.3,
        size: 1.2 + Math.random() * 1.4, life: 80
      });
    }
  }
}
