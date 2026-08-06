// BLOODRIFT figure renderer (art layer). Draws one fighter, anatomically, at
// origin = feet-centre with -y up. View-only; reads sim state, never writes it.
//
// Everything character-specific comes from data/looks.json (D-019): build
// proportions + an ordered `parts` list. The skeleton below is shared, so a new
// fighter is a data entry, not code.

import { rr, rrs, limb, ball, shade, shadeCss, withAlpha } from './draw2d.mjs';
import { resolveMove } from '../sim/sim.mjs';

const OUTLINE = '#070507';

// ---------------------------------------------------------------- skeleton

function poseOf(sim, f, look, t) {
  const st = f.stats;
  const b = look.build;
  const H = st.height;
  const W = st.width * 0.86;
  const face = f.facing;

  let crouchK = 0, guard = false, mv = null, activeK = 0, useLimb = 'ARMS';
  let airborne = false, walking = false, wakeK = 0;
  switch (f.state) {
    case 'crouch': crouchK = 0.38; break;
    case 'prejump': crouchK = 0.34; break;
    case 'air': case 'launched': airborne = true; break;
    case 'walkF': case 'walkB': walking = true; break;
    case 'dashF': case 'dashB': walking = true; break;
    case 'blockstun': guard = true; break;
    case 'wakeup': wakeK = 1 - f.stateT / Math.max(1, f.stateDur); crouchK = 0.5 * wakeK; break;
    case 'stance': crouchK = 0.22; guard = true; break;
    case 'move': {
      mv = resolveMove(f.char, f.moveId, f.moveVar);
      const fr = mv.frames;
      useLimb = mv.uses || 'ARMS';
      if (f.moveF <= fr.startup) activeK = 0.55 * (f.moveF / Math.max(1, fr.startup));
      else if (f.moveF <= fr.startup + fr.active) activeK = 1;
      else activeK = Math.max(0, 0.7 * (1 - (f.moveF - fr.startup - fr.active) / Math.max(1, fr.recovery)));
      if (mv.trigger && mv.trigger.pos === 'crouch') crouchK = 0.3;
      break;
    }
  }
  if (!mv && ['idle', 'walkB', 'walkF', 'crouch'].includes(f.state)) {
    if (sim.trackers[f.id].cur & 512) guard = true;
  }

  // breathing / fight-stance bob (counter-phased hips and shoulders)
  const idleish = !mv && !airborne;
  const bobP = t * 0.055 + f.id * 2.1;
  const bob = idleish ? Math.sin(bobP) * 2.4 : Math.sin(bobP) * 0.7;
  const breath = idleish ? Math.sin(bobP * 0.8) * 1.8 : 0.4;

  const legLen = H * 0.44 * (1 - crouchK * 0.42);
  const hipY = -legLen + bob * 0.5;
  const torsoH = H * 0.38;
  const shoulderY = hipY - torsoH - breath * 0.4;
  const shW = W * 0.36 * b.shoulder;
  const waistW = W * 0.36 * b.waist;
  const neckLen = H * 0.035 * b.neck;
  const hunch = (b.hunch || 0) * W;
  const neckX = face * (hunch + (mv ? activeK * 3 : 0));
  const neckY = shoulderY - neckLen;
  const headR = W * 0.33 * b.head;
  const headY = neckY - headR * 0.92 - bob * 0.3;
  const headX = neckX + face * headR * 0.12;

  return {
    H, W, face, b, look, t,
    crouchK, guard, mv, activeK, useLimb, airborne, walking, wakeK, idleish,
    bob, breath, legLen, hipY, torsoH, shoulderY, shW, waistW,
    neckX, neckY, headR, headY, headX,
    armW: W * 0.23 * b.limb,
    legW: W * 0.29 * b.limb,
    hitFlash: f.state === 'hitstun' && f.stateT < 3
  };
}

// ---------------------------------------------------------------- body pieces

function torsoPath(cx, g, expand = 0) {
  const { shW, waistW, shoulderY, hipY } = g;
  const sw = shW + expand, ww = waistW + expand;
  const midY = (shoulderY + hipY) / 2;
  cx.beginPath();
  cx.moveTo(-sw, shoulderY);
  cx.quadraticCurveTo(-sw * 1.02, midY, -ww, hipY + 2);
  cx.quadraticCurveTo(0, hipY + 8 + expand, ww, hipY + 2);
  cx.quadraticCurveTo(sw * 1.02, midY, sw, shoulderY);
  cx.quadraticCurveTo(0, shoulderY - 7 - expand, -sw, shoulderY);
  cx.closePath();
}

function drawTorso(cx, g, pal) {
  const { shW, shoulderY, hipY, face } = g;
  // outline
  cx.strokeStyle = OUTLINE;
  cx.lineWidth = 3.5;
  torsoPath(cx, g, 0);
  const base = g.hitFlash ? '#ff5a64' : pal.primary;
  const tg = cx.createLinearGradient(-shW, 0, shW, 0);
  tg.addColorStop(0, shade(base, face > 0 ? 30 : -18));
  tg.addColorStop(0.45, shade(base, 4));
  tg.addColorStop(1, shade(base, face > 0 ? -40 : -6));
  cx.fillStyle = tg;
  cx.fill();
  cx.stroke();

  // pectoral / ab modelling
  const chestY = shoulderY + g.torsoH * 0.24;
  cx.fillStyle = 'rgba(0,0,0,0.16)';
  cx.beginPath();
  cx.moveTo(0, shoulderY + 4);
  cx.lineTo(0, hipY - g.torsoH * 0.14);
  cx.lineWidth = 2;
  cx.strokeStyle = 'rgba(0,0,0,0.2)';
  cx.stroke();
  cx.beginPath();
  cx.ellipse(-shW * 0.42, chestY, shW * 0.36, g.torsoH * 0.16, 0.1, 0, Math.PI * 2);
  cx.fill();
  cx.beginPath();
  cx.ellipse(shW * 0.42, chestY, shW * 0.36, g.torsoH * 0.16, -0.1, 0, Math.PI * 2);
  cx.fill();
  // top rim light
  cx.strokeStyle = 'rgba(255,244,224,0.32)';
  cx.lineWidth = 2;
  cx.beginPath();
  cx.moveTo(-shW * 0.8, shoulderY - 1);
  cx.quadraticCurveTo(0, shoulderY - 7, shW * 0.8, shoulderY - 1);
  cx.stroke();
  // grounded shadow under the ribs
  cx.fillStyle = 'rgba(0,0,0,0.2)';
  cx.beginPath();
  cx.ellipse(0, hipY - 1, g.waistW * 0.92, g.torsoH * 0.07, 0, 0, Math.PI * 2);
  cx.fill();
}

// legs are drawn one at a time so the torso can sit between them (near/far depth)
function legPose(g, near) {
  const { legLen, face, walking, airborne, t } = g;
  const spread = Math.max(g.waistW * 0.95, g.legW * 0.85);
  // `near` = the leg on the camera side (lit); far leg is the other one
  const s = near ? 1 : -1;
  if (airborne) {
    return { hipX: s * spread, footX: s * spread - face * (near ? 12 : 10), lift: legLen * (near ? 0.3 : 0.44) };
  }
  if (walking) {
    const ph = t * 0.23 + (near ? Math.PI : 0);
    const sw = Math.sin(ph);
    return { hipX: s * spread, footX: s * spread + sw * 26, lift: Math.max(0, sw) * 13 };
  }
  // bladed fighting stance: lead foot forward, rear foot planted back
  return near
    ? { hipX: spread, footX: face * (spread + 24), lift: 0 }
    : { hipX: -spread, footX: -face * (spread + 18), lift: 0 };
}

function drawLeg(cx, g, pal, p, tone) {
  const { legW, hipY, face, crouchK } = g;
  const legCol = shadeCss(pal.secondary, tone);
  const kneeX = (p.hipX + p.footX) / 2 + face * (7 + p.lift * 0.5 + crouchK * 16);
  const kneeY = (hipY + (-p.lift)) / 2 - p.lift * 0.2;
  limb(cx, p.hipX, hipY, kneeX, kneeY, p.footX, -p.lift, legW, legCol, OUTLINE);
  ball(cx, kneeX, kneeY, legW * 0.4, shadeCss(legCol, 8), null);
  cx.fillStyle = shadeCss(pal.secondary, tone - 22);
  cx.strokeStyle = OUTLINE;
  cx.lineWidth = 2;
  rrs(cx, p.footX - legW * 0.5 + face * 5, -p.lift - legW * 0.5, legW * 1.5, legW * 0.7, 3);
}

function drawKick(cx, g, pal) {
  const { legW, hipY, face, legLen, mv, activeK } = g;
  const kl = g.W * 0.75 + activeK * g.W * 1.6;
  const kh = mv.guard === 'low' ? -legW * 0.5 : -legLen * (0.72 + activeK * 0.5);
  limb(cx, face * g.waistW * 0.5, hipY, face * kl * 0.46, hipY * 0.5 + kh * 0.35,
    face * kl, kh, legW, shadeCss(pal.secondary, 14), OUTLINE);
  cx.fillStyle = shade(pal.secondary, -20);
  cx.strokeStyle = OUTLINE;
  cx.lineWidth = 2;
  rrs(cx, face * kl - legW * 0.55, kh - legW * 0.46, legW * 1.55, legW * 0.76, 3);
}

// one arm. `near` = camera-side (lit, drawn over the torso); far arm goes behind it.
function drawArm(cx, g, pal, f, near) {
  const { armW, shoulderY, shW, face, torsoH, guard, mv, activeK, useLimb, walking, t } = g;
  const tone = near ? 8 : -30;
  const armCol = shadeCss(shade(pal.primary, -14), tone);
  const skin = shadeCss(g.look.skin, tone);
  const shY = shoulderY + torsoH * 0.07;
  const anchorX = (near ? 1 : -1) * shW * 1.0;
  const hand = (x, y, r) => ball(cx, x, y, r, skin, OUTLINE);

  // shoulder cap straddles the torso edge — half in, half out
  ball(cx, anchorX, shY - 2, armW * 0.62, shadeCss(pal.primary, tone - 10), OUTLINE);

  const striking = mv && (useLimb === 'ARMS' || useLimb === 'BODY') && activeK > 0.1;

  if (striking && near) {
    // lead arm straightening into the blow
    const reach = g.W * 0.55 + activeK * g.W * 1.7;
    const fy = shY + torsoH * 0.02 - activeK * 6;
    const ex = face * reach * (0.44 + 0.14 * activeK);
    const ey = fy + (1 - activeK) * 22;
    limb(cx, anchorX, shY, ex, ey, face * reach, fy, armW * 1.04, armCol, OUTLINE);
    hand(face * reach, fy, armW * 0.68);
    if (activeK === 1) {
      const r = g.W * 1.5;
      const a0 = face > 0 ? -0.72 : Math.PI - 0.72, a1 = face > 0 ? 0.56 : Math.PI + 0.56;
      cx.strokeStyle = 'rgba(255,255,255,0.55)';
      cx.lineWidth = 4;
      cx.beginPath(); cx.arc(anchorX, shY, r, a0, a1); cx.stroke();
      cx.strokeStyle = withAlpha(pal.accent, 0.32);
      cx.lineWidth = 11;
      cx.beginPath(); cx.arc(anchorX, shY, r - 6, a0 + 0.1, a1 - 0.06); cx.stroke();
    }
    return;
  }
  if (striking && !near) {
    // rear arm chambered at the hip, counterweighting the strike
    limb(cx, anchorX, shY, anchorX - face * shW * 0.4, shY + torsoH * 0.34,
      anchorX + face * shW * 0.1, shY + torsoH * 0.52, armW, armCol, OUTLINE);
    hand(anchorX + face * shW * 0.1, shY + torsoH * 0.52, armW * 0.56);
    return;
  }
  if (guard) {
    if (near) {
      limb(cx, anchorX, shY, anchorX + face * shW * 0.42, shY + torsoH * 0.22,
        anchorX + face * shW * 0.34, shY - torsoH * 0.14, armW, armCol, OUTLINE);
      hand(anchorX + face * shW * 0.34, shY - torsoH * 0.14, armW * 0.6);
      cx.strokeStyle = 'rgba(143,168,200,0.42)';
      cx.lineWidth = 2.5;
      cx.beginPath();
      cx.arc(face * shW * 0.6, shY + torsoH * 0.06, g.W * 0.6, -1.15, 1.15);
      cx.stroke();
    } else {
      limb(cx, anchorX, shY, anchorX + face * shW * 0.3, shY + torsoH * 0.2,
        face * shW * 0.06, shY - torsoH * 0.18, armW, armCol, OUTLINE);
      hand(face * shW * 0.06, shY - torsoH * 0.18, armW * 0.56);
    }
    return;
  }
  // relaxed fighting posture — hands low and ready, elbows out a little
  const swing = walking ? Math.sin(t * 0.23 + (near ? Math.PI : 0)) * 9 : Math.sin(t * 0.05 + f.id + (near ? 0 : 1)) * 2;
  const out = (near ? 1 : -1);
  const elbowX = anchorX + out * shW * 0.34 + swing * 0.3;
  const handX = anchorX + out * shW * 0.2 + face * shW * 0.3 + swing;
  limb(cx, anchorX, shY, elbowX, shY + torsoH * 0.36, handX, shY + torsoH * 0.62, armW, armCol, OUTLINE);
  hand(handX, shY + torsoH * 0.62, armW * 0.58);
}

function drawHead(cx, g, pal, f) {
  const { headX, headY, headR, neckX, neckY, shoulderY, face } = g;
  const skin = g.hitFlash ? '#ff6a72' : g.look.skin;
  // neck
  cx.fillStyle = shade(skin, -30);
  cx.strokeStyle = OUTLINE;
  cx.lineWidth = 2.5;
  rrs(cx, neckX - headR * 0.36, neckY - 2, headR * 0.72, (shoulderY - neckY) + 8, 3);
  // skull — slightly egg-shaped, jaw toward facing
  cx.save();
  cx.translate(headX, headY);
  cx.scale(1, 1.08);
  ball(cx, 0, 0, headR, skin, OUTLINE, face > 0 ? -0.34 : 0.34, -0.42);
  cx.restore();
  // jaw / brow shaping
  cx.fillStyle = 'rgba(0,0,0,0.14)';
  cx.beginPath();
  cx.ellipse(headX - face * headR * 0.34, headY + headR * 0.36, headR * 0.55, headR * 0.34, 0, 0, Math.PI * 2);
  cx.fill();
  cx.fillStyle = 'rgba(255,255,255,0.3)';
  cx.beginPath();
  cx.ellipse(headX - face * headR * 0.36, headY - headR * 0.44, headR * 0.18, headR * 0.1, -0.5, 0, Math.PI * 2);
  cx.fill();

  // default features so a bare face isn't a blank egg (masks/visors overdraw these)
  if (!g.look.parts.some(p => ['visor', 'helm', 'deathmask', 'flamehead', 'rangefinder', 'hazmathood', 'compoundeyes', 'eyes'].includes(p.type))) {
    cx.fillStyle = 'rgba(20,14,16,0.62)';
    for (const s of [0.44, 0.08]) {
      cx.beginPath();
      cx.ellipse(headX + face * headR * s, headY - headR * 0.12, headR * 0.11, headR * 0.13, 0, 0, Math.PI * 2);
      cx.fill();
    }
    cx.strokeStyle = 'rgba(20,14,16,0.45)';
    cx.lineWidth = Math.max(1.2, headR * 0.09);
    cx.beginPath();
    cx.moveTo(headX + face * headR * 0.62, headY - headR * 0.34);
    cx.lineTo(headX - face * headR * 0.06, headY - headR * 0.28);
    cx.stroke();
    // set jaw
    cx.beginPath();
    cx.moveTo(headX + face * headR * 0.5, headY + headR * 0.42);
    cx.lineTo(headX + face * headR * 0.16, headY + headR * 0.46);
    cx.stroke();
  }
}

// ---------------------------------------------------------------- parts

const PARTS = {
  cape(cx, p, g) {
    const { shoulderY, shW, face, t } = g;
    const len = (p.len || 1) * g.H * 0.5;
    const sway = Math.sin(t * 0.06) * 6 + (g.walking ? Math.sin(t * 0.2) * 8 : 0);
    cx.fillStyle = p.col;
    cx.beginPath();
    cx.moveTo(-face * shW * 0.9, shoulderY - 2);
    cx.quadraticCurveTo(-face * (shW * 1.5 + sway), shoulderY + len * 0.5, -face * (shW * 1.2 + sway * 1.4), shoulderY + len);
    const tat = p.tatter || 3;
    for (let i = 0; i < tat; i++) {
      const kx = -face * (shW * (1.15 - i * 0.16) + sway * (1.2 - i * 0.2));
      cx.lineTo(kx, shoulderY + len - (i % 2 ? 14 : 0));
      cx.lineTo(kx + face * 8, shoulderY + len - 22);
    }
    cx.lineTo(face * shW * 0.2, shoulderY + 4);
    cx.closePath();
    cx.fill();
    cx.strokeStyle = 'rgba(0,0,0,0.4)';
    cx.lineWidth = 1.5;
    cx.stroke();
  },
  coat(cx, p, g) {
    const { shoulderY, shW, hipY, face, t } = g;
    const len = (p.len || 1) * g.H * 0.46;
    const sway = Math.sin(t * 0.055) * 5;
    cx.fillStyle = p.lining || '#3a1018';
    cx.beginPath();
    cx.moveTo(-shW * 0.9, shoulderY);
    cx.quadraticCurveTo(-shW * 1.5 - sway, hipY + len * 0.5, -shW * 1.15 - sway, shoulderY + len);
    cx.lineTo(shW * 1.15 + sway, shoulderY + len);
    cx.quadraticCurveTo(shW * 1.5 + sway, hipY + len * 0.5, shW * 0.9, shoulderY);
    cx.closePath();
    cx.fill();
    cx.fillStyle = p.col;
    cx.beginPath();
    cx.moveTo(-shW * 0.95, shoulderY);
    cx.quadraticCurveTo(-shW * 1.42 - sway, hipY + len * 0.45, -shW * 1.05 - sway, shoulderY + len * 0.94);
    const tat = p.tatter || 0;
    if (tat) {
      for (let i = 0; i < tat; i++) {
        const fx = -shW * 1.05 + (i / tat) * shW * 2.1;
        cx.lineTo(fx, shoulderY + len * (0.86 + (i % 2 ? 0.12 : 0)));
      }
    }
    cx.lineTo(shW * 1.05 + sway, shoulderY + len * 0.94);
    cx.quadraticCurveTo(shW * 1.42 + sway, hipY + len * 0.45, shW * 0.95, shoulderY);
    cx.closePath();
    cx.fill();
    cx.strokeStyle = 'rgba(0,0,0,0.5)';
    cx.lineWidth = 1.6;
    cx.stroke();
    if (p.collar) {
      cx.fillStyle = shade(p.col, 26);
      cx.beginPath();
      cx.moveTo(-shW * 0.5, shoulderY + 2);
      cx.lineTo(-shW * 1.02, shoulderY - g.torsoH * 0.34);
      cx.lineTo(-shW * 0.2, shoulderY - 2);
      cx.closePath(); cx.fill();
      cx.beginPath();
      cx.moveTo(shW * 0.5, shoulderY + 2);
      cx.lineTo(shW * 1.02, shoulderY - g.torsoH * 0.34);
      cx.lineTo(shW * 0.2, shoulderY - 2);
      cx.closePath(); cx.fill();
    }
  },
  pauldrons(cx, p, g) {
    const { shoulderY, shW, torsoH, face } = g;
    // sit exactly over the arm's shoulder cap so they read as armour, not extra balls
    const r = g.armW * (p.size || 1) * 0.92;
    for (const s of [-1, 1]) {
      const x = s * shW * 1.0;
      ball(cx, x, shoulderY + torsoH * 0.02, r, s === face ? shade(p.col, 12) : shade(p.col, -22), OUTLINE);
      if (p.spikes) {
        cx.fillStyle = shade(p.col, -10);
        cx.beginPath();
        cx.moveTo(x - r * 0.5, shoulderY - r * 0.3);
        cx.lineTo(x + s * r * 0.2, shoulderY - r * 1.5);
        cx.lineTo(x + r * 0.5, shoulderY - r * 0.2);
        cx.closePath(); cx.fill();
      }
      if (p.bone) {
        cx.strokeStyle = 'rgba(80,70,60,0.5)';
        cx.lineWidth = 1.2;
        for (let k = -1; k <= 1; k++) {
          cx.beginPath();
          cx.arc(x, shoulderY + torsoH * 0.02, r * (0.5 + k * 0.22), Math.PI * 0.9, Math.PI * 2.1);
          cx.stroke();
        }
      }
    }
  },
  chestplate(cx, p, g) {
    const { shoulderY, shW, torsoH, face } = g;
    const y = shoulderY + torsoH * 0.1;
    const h = torsoH * 0.38;
    const w = shW * 1.36;
    const pg = cx.createLinearGradient(-w / 2, 0, w / 2, 0);
    pg.addColorStop(0, shade(p.col, face > 0 ? 40 : -6));
    pg.addColorStop(0.5, shade(p.col, 14));
    pg.addColorStop(1, shade(p.col, face > 0 ? -20 : 10));
    cx.fillStyle = pg;
    cx.strokeStyle = OUTLINE;
    cx.lineWidth = 2;
    if (p.style === 'chitin') {
      for (let i = 0; i < 3; i++) {
        cx.fillStyle = i % 2 ? shade(p.col, 26) : shade(p.col, 6);
        rrs(cx, -w / 2 + i * 2, y + i * h * 0.3, w - i * 4, h * 0.32, 6);
      }
      cx.strokeStyle = withAlpha(p.sheen || '#d8a05a', 0.5);
      cx.lineWidth = 1.4;
      cx.beginPath();
      cx.moveTo(-w * 0.4, y + 3); cx.lineTo(w * 0.4, y + 3);
      cx.stroke();
    } else if (p.style === 'chassis') {
      rrs(cx, -w / 2, y, w, h, 4);
      cx.fillStyle = p.wet || '#8a3a44';
      rr(cx, -w * 0.18, y + h * 0.3, w * 0.36, h * 0.3, 3);
      cx.strokeStyle = 'rgba(0,0,0,0.5)';
      cx.lineWidth = 1.2;
      for (let i = 1; i < 4; i++) {
        cx.beginPath();
        cx.moveTo(-w / 2 + (w / 4) * i, y);
        cx.lineTo(-w / 2 + (w / 4) * i, y + h);
        cx.stroke();
      }
    } else {
      // a fitted breastplate: shoulders squared, tapering to a V at the sternum
      cx.beginPath();
      cx.moveTo(-w / 2, y + 4);
      cx.quadraticCurveTo(0, y - 5, w / 2, y + 4);
      cx.lineTo(w * 0.42, y + h * 0.72);
      cx.quadraticCurveTo(0, y + h * 1.12, -w * 0.42, y + h * 0.72);
      cx.closePath();
      cx.fill(); cx.stroke();
      cx.strokeStyle = 'rgba(255,255,255,0.2)';
      cx.lineWidth = 1.5;
      cx.beginPath();
      cx.moveTo(-w * 0.4, y + h * 0.36);
      cx.quadraticCurveTo(0, y + h * 0.5, w * 0.4, y + h * 0.36);
      cx.stroke();
    }
  },
  beamplate(cx, p, g) {
    const { shoulderY, shW, torsoH } = g;
    cx.fillStyle = p.col;
    cx.strokeStyle = OUTLINE;
    cx.lineWidth = 2;
    rrs(cx, -shW * 0.8, shoulderY + torsoH * 0.3, shW * 1.6, torsoH * 0.16, 2);
    cx.fillStyle = shade(p.col, -20);
    rr(cx, -shW * 0.7, shoulderY + torsoH * 0.33, shW * 1.4, torsoH * 0.05, 1);
  },
  vest(cx, p, g) {
    const { shoulderY, shW, torsoH, hipY } = g;
    cx.fillStyle = p.col;
    cx.strokeStyle = OUTLINE;
    cx.lineWidth = 2.5;
    cx.beginPath();
    cx.moveTo(-shW * 0.86, shoulderY + 3);
    cx.lineTo(-g.waistW * 1.05, hipY);
    cx.lineTo(g.waistW * 1.05, hipY);
    cx.lineTo(shW * 0.86, shoulderY + 3);
    cx.closePath();
    cx.fill(); cx.stroke();
    cx.fillStyle = p.stripe || '#f0e9d8';
    cx.fillRect(-shW * 0.72, shoulderY + torsoH * 0.42, shW * 1.44, torsoH * 0.1);
    cx.globalAlpha = 0.5;
    cx.fillRect(-shW * 0.4, shoulderY + 4, shW * 0.12, torsoH * 0.8);
    cx.fillRect(shW * 0.28, shoulderY + 4, shW * 0.12, torsoH * 0.8);
    cx.globalAlpha = 1;
  },
  harness(cx, p, g) {
    const { shoulderY, shW, torsoH } = g;
    cx.strokeStyle = p.col;
    cx.lineWidth = 4;
    cx.beginPath();
    cx.moveTo(-shW * 0.7, shoulderY + 4);
    cx.lineTo(shW * 0.5, shoulderY + torsoH * 0.72);
    cx.stroke();
    cx.lineWidth = 3;
    cx.beginPath();
    cx.moveTo(-shW * 0.75, shoulderY + torsoH * 0.5);
    cx.lineTo(shW * 0.75, shoulderY + torsoH * 0.52);
    cx.stroke();
    // instrument loops
    cx.fillStyle = '#b0b6bc';
    for (let i = 0; i < 3; i++) {
      cx.fillRect(-shW * 0.6 + i * shW * 0.42, shoulderY + torsoH * 0.5, 3, 9);
    }
  },
  cross(cx, p, g) {
    const { shoulderY, shW, torsoH } = g;
    const y = shoulderY + torsoH * 0.16, s = shW * 0.42;
    cx.strokeStyle = p.col;
    cx.lineWidth = 5;
    cx.lineCap = 'round';
    cx.beginPath();
    cx.moveTo(-s * 0.55, y); cx.lineTo(s * 0.55, y + s * 1.1);
    cx.moveTo(s * 0.55, y); cx.lineTo(-s * 0.55, y + s * 1.1);
    cx.stroke();
    cx.lineCap = 'butt';
  },
  boneplates(cx, p, g) {
    const { shoulderY, shW, torsoH } = g;
    cx.strokeStyle = shade(p.col, -60);
    cx.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      const y = shoulderY + torsoH * (0.12 + i * 0.18);
      const w = shW * (1.42 - i * 0.14);
      cx.fillStyle = shade(p.col, 12 - i * 6);
      rrs(cx, -w / 2, y, w, torsoH * 0.15, 5);
    }
    // cathedral tracery
    cx.strokeStyle = 'rgba(120,110,95,0.6)';
    cx.lineWidth = 1;
    for (let i = -1; i <= 1; i++) {
      cx.beginPath();
      cx.arc(i * shW * 0.5, shoulderY + torsoH * 0.5, shW * 0.28, Math.PI, 0);
      cx.stroke();
    }
  },
  vertebrae(cx, p, g) {
    const { shoulderY, face, shW, t } = g;
    cx.fillStyle = p.col;
    cx.strokeStyle = 'rgba(0,0,0,0.4)';
    cx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const a = -face * (shW * 1.15 + Math.sin(t * 0.04 + i) * 3);
      const y = shoulderY + i * g.H * 0.045;
      cx.beginPath();
      cx.ellipse(a, y, 7, 4.5, 0.3, 0, Math.PI * 2);
      cx.fill(); cx.stroke();
    }
  },
  wraps(cx, p, g) {
    const { shoulderY, shW, torsoH, t, face } = g;
    cx.strokeStyle = p.col;
    cx.lineWidth = 4.5;
    for (let i = 0; i < 6; i++) {
      const y = shoulderY + torsoH * (0.06 + i * 0.16);
      const wob = Math.sin(t * 0.05 + i * 1.3) * 4;
      cx.beginPath();
      cx.moveTo(-shW * (0.95 - i * 0.04), y);
      cx.quadraticCurveTo(0, y + 5 + wob, shW * (0.95 - i * 0.04), y + 2);
      cx.stroke();
    }
    // loose ends drifting
    cx.lineWidth = 3;
    for (let i = 0; i < 2; i++) {
      const wob = Math.sin(t * 0.07 + i * 2) * 12;
      cx.beginPath();
      cx.moveTo(-face * shW * 0.9, shoulderY + torsoH * (0.4 + i * 0.3));
      cx.quadraticCurveTo(-face * (shW * 1.6), shoulderY + torsoH * 0.6 + wob,
        -face * (shW * 2.1), shoulderY + torsoH * 0.9 + wob);
      cx.stroke();
    }
  },
  sandfall(cx, p, g) {
    const { hipY, waistW, t } = g;
    cx.fillStyle = withAlpha(p.col, 0.5);
    for (let i = 0; i < 10; i++) {
      const ph = (t * 0.9 + i * 37) % 60;
      const x = ((i * 53) % 100 - 50) / 50 * waistW;
      cx.fillRect(x, hipY + ph * 0.9, 1.6, 3.5);
    }
  },
  jars(cx, p, g) {
    const { shoulderY, shW, t } = g;
    const n = p.count || 4;
    for (let i = 0; i < n; i++) {
      const a = t * 0.012 + (i / n) * Math.PI * 2;
      const x = Math.cos(a) * shW * 1.5;
      const y = shoulderY - g.torsoH * 0.1 + Math.sin(a) * g.torsoH * 0.3;
      const sc = 0.7 + 0.3 * Math.sin(a);
      cx.fillStyle = shade('#c8b48a', Math.sin(a) * 20);
      cx.strokeStyle = OUTLINE;
      cx.lineWidth = 1.4;
      rrs(cx, x - 6 * sc, y - 9 * sc, 12 * sc, 18 * sc, 3);
      cx.fillStyle = withAlpha(p.col, 0.7);
      cx.fillRect(x - 4 * sc, y - 11 * sc, 8 * sc, 4 * sc);
    }
  },
  ghosts(cx, p, g) {
    // eight bearers, only ever half-there: heads and shoulder-lines, no bodies
    const { shoulderY, shW, torsoH, t, face } = g;
    for (let i = 0; i < 3; i++) {
      const ph = t * 0.03 + i * 2.1;
      const x = -face * shW * (1.15 + i * 0.62) + Math.sin(ph) * 7;
      const y = shoulderY - torsoH * 0.3 + Math.cos(ph * 0.8) * 5;
      const a = 0.13 + 0.06 * Math.sin(ph * 1.7) - i * 0.03;
      const gg = cx.createRadialGradient(x, y, 2, x, y, g.headR * 2.4);
      gg.addColorStop(0, withAlpha(p.col, a * 1.6));
      gg.addColorStop(0.5, withAlpha(p.col, a * 0.55));
      gg.addColorStop(1, withAlpha(p.col, 0));
      cx.fillStyle = gg;
      cx.beginPath();
      cx.arc(x, y, g.headR * 2.4, 0, Math.PI * 2);
      cx.fill();
      cx.globalAlpha = a * 1.5;
      cx.fillStyle = p.col;
      cx.beginPath();
      cx.arc(x, y, g.headR * 0.72, 0, Math.PI * 2);
      cx.fill();
      cx.globalAlpha = 1;
    }
  },
  banner(cx, p, g) {
    const { shoulderY, shW, face, t } = g;
    const bx = -face * shW * 1.25;
    cx.strokeStyle = '#6a5a3a';
    cx.lineWidth = 3;
    cx.beginPath();
    cx.moveTo(bx, shoulderY + g.torsoH * 0.9);
    cx.lineTo(bx, shoulderY - g.H * 0.2);
    cx.stroke();
    const wave = Math.sin(t * 0.07) * 5;
    cx.fillStyle = p.col;
    cx.beginPath();
    cx.moveTo(bx, shoulderY - g.H * 0.19);
    cx.quadraticCurveTo(bx - face * (30 + wave), shoulderY - g.H * 0.1, bx - face * (26 + wave), shoulderY - g.H * 0.02);
    cx.lineTo(bx, shoulderY - g.H * 0.04);
    cx.closePath();
    cx.fill();
    cx.fillStyle = p.accent;
    cx.fillRect(bx - face * 16, shoulderY - g.H * 0.14, 6, 6);
  },
  capacitor(cx, p, g, f) {
    const { shoulderY, shW, torsoH, t } = g;
    const k = Math.min(1, (f.joules || 0) / 300);
    if (k <= 0.02) return;
    cx.strokeStyle = withAlpha(p.col, 0.3 + k * 0.6);
    cx.lineWidth = 2 + k * 2.5;
    cx.beginPath();
    cx.arc(-g.face * shW * 0.6, shoulderY + torsoH * 0.4, g.W * 0.55 + k * 8, -2.4, 0.7);
    cx.stroke();
    if (k > 0.55) {
      cx.strokeStyle = withAlpha('#fffbe0', (k - 0.55) * 1.4);
      cx.lineWidth = 1.4;
      for (let i = 0; i < 4; i++) {
        const a = t * 0.3 + i * 1.6;
        cx.beginPath();
        cx.moveTo(Math.cos(a) * shW * 0.5, shoulderY + torsoH * 0.3 + Math.sin(a) * torsoH * 0.3);
        cx.lineTo(Math.cos(a) * shW * 0.85, shoulderY + torsoH * 0.3 + Math.sin(a) * torsoH * 0.5);
        cx.stroke();
      }
    }
  },
  glowveins(cx, p, g, f) {
    const k = Math.min(1, (f.debt || 0) / 100);
    if (k <= 0.01) return;
    const { shoulderY, torsoH, face, t } = g;
    cx.strokeStyle = withAlpha(p.col, 0.25 + k * 0.6 + 0.1 * Math.sin(t * 0.15));
    cx.lineWidth = 1.6 + k * 1.4;
    for (const s of [-1, 1]) {
      cx.beginPath();
      cx.moveTo(s * g.shW * 0.2, shoulderY + torsoH * 0.9);
      cx.lineTo(s * g.shW * 0.42, shoulderY + torsoH * 0.4);
      cx.lineTo(s * g.shW * 0.16, shoulderY + torsoH * 0.1);
      cx.lineTo(s * g.shW * 0.3, g.neckY);
      cx.stroke();
    }
  },
  shiftcore(cx, p, g) {
    const { shoulderY, torsoH, face, t } = g;
    const x = -face * g.shW * 0.72;
    cx.strokeStyle = withAlpha(p.col, 0.55 + 0.25 * Math.sin(t * 0.12));
    cx.lineWidth = 4;
    cx.beginPath();
    cx.moveTo(x, shoulderY - 4);
    cx.lineTo(x, shoulderY + torsoH * 0.85);
    cx.stroke();
    cx.fillStyle = withAlpha(p.col, 0.9);
    for (let i = 0; i < 5; i++) {
      cx.beginPath();
      cx.arc(x, shoulderY + torsoH * (0.02 + i * 0.2), 3.2, 0, Math.PI * 2);
      cx.fill();
    }
  },
  flightsuit(cx, p, g) {
    const { shoulderY, shW, torsoH } = g;
    cx.strokeStyle = withAlpha(p.trim, 0.55);
    cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(-shW * 0.7, shoulderY + torsoH * 0.3);
    cx.lineTo(shW * 0.7, shoulderY + torsoH * 0.3);
    cx.stroke();
    cx.strokeStyle = 'rgba(0,0,0,0.3)';
    cx.beginPath();
    cx.moveTo(0, shoulderY + torsoH * 0.32);
    cx.lineTo(0, shoulderY + torsoH * 0.95);
    cx.stroke();
  },
  crystalset(cx, p, g, f) {
    if (f.gset !== (p.set || 'power')) return;
    const { shoulderY, shW, torsoH } = g;
    cx.fillStyle = withAlpha(p.col, 0.75);
    cx.strokeStyle = withAlpha('#ffffff', 0.5);
    cx.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const x = Math.cos(a) * shW * 0.9, y = shoulderY + torsoH * 0.4 + Math.sin(a) * torsoH * 0.42;
      cx.beginPath();
      cx.moveTo(x, y - 9);
      cx.lineTo(x + 6, y);
      cx.lineTo(x, y + 9);
      cx.lineTo(x - 6, y);
      cx.closePath();
      cx.fill(); cx.stroke();
    }
  },
  bladeset(cx, p, g, f) {
    if (f.gset !== (p.set || 'finesse')) return;
    const { shoulderY, shW, torsoH, face } = g;
    cx.fillStyle = p.col;
    cx.strokeStyle = OUTLINE;
    cx.lineWidth = 1.4;
    for (const s of [-1, 1]) {
      cx.beginPath();
      cx.moveTo(s * shW * 0.9, shoulderY + torsoH * 0.1);
      cx.lineTo(s * shW * 1.5, shoulderY - torsoH * 0.3);
      cx.lineTo(s * shW * 1.0, shoulderY + torsoH * 0.26);
      cx.closePath();
      cx.fill(); cx.stroke();
    }
  },
  fourarms(cx, p, g) {
    const { shoulderY, shW, torsoH, face, t } = g;
    const y = shoulderY + torsoH * 0.22;
    const sway = Math.sin(t * 0.05) * 5;
    for (const s of [-1, 1]) {
      // the blade-limbs frame her, held wide like a mantis at rest
      limb(cx, s * shW * 0.7, y, s * shW * 1.9, y - torsoH * 0.12 + sway,
        s * shW * 1.6, y + torsoH * 0.55, g.armW * 0.72, p.col, OUTLINE);
      // blade tips
      cx.fillStyle = p.blade;
      cx.strokeStyle = OUTLINE;
      cx.lineWidth = 1.2;
      cx.beginPath();
      cx.moveTo(s * shW * 1.6, y + torsoH * 0.52);
      cx.lineTo(s * shW * 2.1, y + torsoH * 1.15);
      cx.lineTo(s * shW * 1.42, y + torsoH * 0.68);
      cx.closePath();
      cx.fill(); cx.stroke();
    }
  },
  wings(cx, p, g) {
    const { shoulderY, shW, torsoH, t } = g;
    const flut = Math.sin(t * 0.09) * 0.12;
    for (const s of [-1, 1]) {
      cx.save();
      cx.translate(s * shW * 0.6, shoulderY + torsoH * 0.1);
      cx.rotate(s * (0.5 + flut));
      const wg = cx.createLinearGradient(0, 0, 0, torsoH * 1.1);
      wg.addColorStop(0, withAlpha(p.sheen, 0.35));
      wg.addColorStop(1, withAlpha(p.col, 0.12));
      cx.fillStyle = wg;
      cx.beginPath();
      cx.ellipse(0, torsoH * 0.5, shW * 0.42, torsoH * 0.62, 0, 0, Math.PI * 2);
      cx.fill();
      cx.strokeStyle = withAlpha(p.sheen, 0.35);
      cx.lineWidth = 1;
      cx.stroke();
      cx.restore();
    }
  },
  larvae(cx, p, g) {
    const { shoulderY, shW, t } = g;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI - 0.2;
      const wob = Math.sin(t * 0.11 + i * 1.4) * 2.4;
      const x = Math.cos(a) * shW * 1.02;
      const y = shoulderY + Math.sin(a) * 7 + 3 + wob;
      cx.fillStyle = shade(p.col, (i % 3) * 10);
      cx.beginPath();
      cx.ellipse(x, y, 4.6, 3, a, 0, Math.PI * 2);
      cx.fill();
    }
  },
  mismatch(cx, p, g) {
    // one giant shoulder + a lighter panel down the other side: GRAFT's asymmetry
    const { shoulderY, shW, torsoH, face } = g;
    ball(cx, -face * shW * 0.98, shoulderY + torsoH * 0.03, g.armW * 0.95, shade(p.col, -10), OUTLINE);
    cx.fillStyle = withAlpha(p.alt, 0.4);
    rr(cx, face * shW * 0.14, shoulderY + torsoH * 0.14, shW * 0.7, torsoH * 0.46, 5);
  },
  sutures(cx, p, g) {
    const { shoulderY, shW, torsoH, neckX, neckY } = g;
    cx.strokeStyle = p.col;
    cx.lineWidth = 1.6;
    if (p.neckOnly) {
      cx.beginPath();
      cx.moveTo(neckX - g.headR * 0.4, neckY + 2);
      cx.lineTo(neckX + g.headR * 0.4, neckY + 2);
      cx.stroke();
      for (let i = -2; i <= 2; i++) {
        cx.beginPath();
        cx.moveTo(neckX + i * 5, neckY - 2);
        cx.lineTo(neckX + i * 5, neckY + 6);
        cx.stroke();
      }
      return;
    }
    for (let k = 0; k < 3; k++) {
      const y = shoulderY + torsoH * (0.2 + k * 0.24);
      cx.beginPath();
      cx.moveTo(-shW * 0.85, y);
      cx.lineTo(shW * 0.85, y - 4);
      cx.stroke();
      for (let i = -3; i <= 3; i++) {
        const x = i * shW * 0.26;
        cx.beginPath();
        cx.moveTo(x, y - 5);
        cx.lineTo(x + 3, y + 4);
        cx.stroke();
      }
    }
  },
  staples(cx, p, g) {
    const { shoulderY, shW, torsoH } = g;
    cx.strokeStyle = p.col;
    cx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const x = -shW * 0.6 + i * shW * 0.3;
      const y = shoulderY + torsoH * (0.5 + (i % 2) * 0.2);
      cx.beginPath();
      cx.moveTo(x - 3, y - 3); cx.lineTo(x - 3, y + 3);
      cx.moveTo(x - 3, y); cx.lineTo(x + 3, y);
      cx.moveTo(x + 3, y - 3); cx.lineTo(x + 3, y + 3);
      cx.stroke();
    }
  },
  pinnedsleeve(cx, p, g) {
    const { shoulderY, shW, torsoH, face } = g;
    cx.fillStyle = p.col;
    cx.strokeStyle = OUTLINE;
    cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(-face * shW * 0.82, shoulderY);
    cx.lineTo(-face * shW * 1.05, shoulderY + torsoH * 0.34);
    cx.lineTo(-face * shW * 0.5, shoulderY + torsoH * 0.3);
    cx.closePath();
    cx.fill(); cx.stroke();
  },
  filaments(cx, p, g) {
    const { shoulderY, shW, torsoH, face, t } = g;
    cx.strokeStyle = withAlpha(p.col, 0.5);
    cx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const wob = Math.sin(t * 0.13 + i * 1.9) * 6;
      cx.beginPath();
      cx.moveTo(face * shW * 0.5, shoulderY + torsoH * 0.35);
      cx.quadraticCurveTo(face * shW * (1 + i * 0.1), shoulderY + torsoH * 0.5 + wob,
        face * shW * (1.3 + i * 0.16), shoulderY + torsoH * (0.3 + i * 0.14) + wob);
      cx.stroke();
    }
  },
  pods(cx, p, g) {
    const { shoulderY, shW, torsoH, face, t } = g;
    for (const s of [-1, 1]) {
      cx.fillStyle = shade(p.col, s === face ? 14 : -18);
      cx.strokeStyle = OUTLINE;
      cx.lineWidth = 2;
      rrs(cx, s * shW * 0.85 - g.armW * 0.6, shoulderY - g.armW * 0.9, g.armW * 1.3, g.armW * 1.5, 3);
      cx.fillStyle = withAlpha(p.accent, 0.55 + 0.25 * Math.sin(t * 0.1 + s));
      cx.fillRect(s * shW * 0.85 - 3, shoulderY - g.armW * 0.5, 6, 3);
    }
    // spine rack
    cx.fillStyle = shade(p.col, -26);
    rr(cx, -face * shW * 0.9, shoulderY + torsoH * 0.1, shW * 0.5, torsoH * 0.6, 3);
  },
  voidbody(cx, p, g) {
    // the suit's tears show depth, not flesh
    const { shoulderY, shW, torsoH, t } = g;
    cx.save();
    torsoPath(cx, g, -2);
    cx.clip();
    cx.fillStyle = '#05040a';
    cx.fillRect(-shW * 2, shoulderY - 20, shW * 4, torsoH * 2);
    for (let i = 0; i < 26; i++) {
      const sx = ((i * 71) % 100) / 100 * shW * 2 - shW;
      const sy = shoulderY + ((i * 137) % 100) / 100 * torsoH;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.03 + i));
      cx.fillStyle = withAlpha(i % 4 ? '#ffffff' : p.col, tw * 0.85);
      cx.fillRect(sx, sy, 1.6, 1.6);
    }
    cx.restore();
  },
  orbit(cx, p, g) {
    const { shoulderY, shW, torsoH, t } = g;
    for (let i = 0; i < 3; i++) {
      const a = t * 0.02 + i * 2.1;
      cx.strokeStyle = withAlpha(p.col, 0.16);
      cx.lineWidth = 1;
      cx.beginPath();
      cx.ellipse(0, shoulderY + torsoH * 0.4, shW * (1.3 + i * 0.2), torsoH * 0.3, a * 0.4, 0, Math.PI * 2);
      cx.stroke();
      cx.fillStyle = withAlpha(p.col, 0.7);
      cx.beginPath();
      cx.arc(Math.cos(a) * shW * (1.3 + i * 0.2), shoulderY + torsoH * 0.4 + Math.sin(a) * torsoH * 0.3, 2.4, 0, Math.PI * 2);
      cx.fill();
    }
  },
  pelt(cx, p, g) {
    const { shoulderY, shW, torsoH, t } = g;
    cx.fillStyle = p.col;
    cx.strokeStyle = 'rgba(0,0,0,0.45)';
    cx.lineWidth = 1.5;
    cx.beginPath();
    cx.moveTo(-shW * 1.05, shoulderY - 2);
    for (let i = 0; i <= 6; i++) {
      const x = -shW * 1.05 + (i / 6) * shW * 2.1;
      cx.lineTo(x, shoulderY + torsoH * (0.16 + (i % 2 ? 0.1 : 0)) + Math.sin(t * 0.04 + i) * 1.5);
    }
    cx.lineTo(shW * 1.05, shoulderY - 2);
    cx.closePath();
    cx.fill(); cx.stroke();
  },
  claws(cx, p, g, f) {
    if (f.gset !== (p.set || 'finesse')) return;
    const { shoulderY, shW, torsoH, face } = g;
    cx.fillStyle = p.col;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        cx.beginPath();
        cx.moveTo(s * shW * (0.9 + i * 0.06), shoulderY + torsoH * 0.58);
        cx.lineTo(s * shW * (1.05 + i * 0.08), shoulderY + torsoH * 0.78);
        cx.lineTo(s * shW * (0.94 + i * 0.06), shoulderY + torsoH * 0.62);
        cx.closePath();
        cx.fill();
      }
    }
  },

  // ---- heads
  visor(cx, p, g, f) {
    const { headX, headY, headR, face } = g;
    // a faceplate, not a sticker: masks the lower face, leaves a burning eye-slit
    cx.fillStyle = p.col;
    cx.strokeStyle = OUTLINE;
    cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(headX - headR * 0.96, headY - headR * 0.34);
    cx.lineTo(headX + headR * 0.96, headY - headR * 0.34);
    cx.quadraticCurveTo(headX + headR * 0.7, headY + headR * 0.95, headX + face * headR * 0.1, headY + headR * 1.0);
    cx.quadraticCurveTo(headX - headR * 0.7, headY + headR * 0.95, headX - headR * 0.96, headY - headR * 0.34);
    cx.closePath();
    cx.fill(); cx.stroke();
    const hot = (f.debt || 0) >= 60;
    const glow = hot ? p.hotGlow : p.glow;
    if (hot) {
      cx.fillStyle = withAlpha(p.hotGlow, 0.3);
      cx.beginPath();
      cx.arc(headX + face * headR * 0.24, headY - headR * 0.16, headR * 0.72, 0, Math.PI * 2);
      cx.fill();
    }
    cx.fillStyle = glow;
    cx.beginPath();
    cx.moveTo(headX - headR * 0.82, headY - headR * 0.24);
    cx.lineTo(headX + headR * 0.82, headY - headR * 0.24);
    cx.lineTo(headX + headR * 0.66, headY - headR * 0.02);
    cx.lineTo(headX - headR * 0.66, headY - headR * 0.02);
    cx.closePath();
    cx.fill();
    // brow ridge catches the key light
    cx.strokeStyle = withAlpha('#fff4dc', 0.4);
    cx.lineWidth = 1.6;
    cx.beginPath();
    cx.moveTo(headX - headR * 0.9, headY - headR * 0.38);
    cx.lineTo(headX + headR * 0.9, headY - headR * 0.38);
    cx.stroke();
  },
  helm(cx, p, g) {
    const { headX, headY, headR, face } = g;
    cx.fillStyle = p.col;
    cx.strokeStyle = OUTLINE;
    cx.lineWidth = 2.4;
    cx.beginPath();
    cx.arc(headX, headY - headR * 0.06, headR * 1.05, Math.PI, 0);
    cx.lineTo(headX + headR * 1.05, headY + headR * 0.4);
    cx.lineTo(headX + face * headR * 0.2, headY + headR * 0.4);
    cx.lineTo(headX - headR * 1.05, headY + headR * 0.4);
    cx.closePath();
    cx.fill(); cx.stroke();
    // eye slit
    cx.fillStyle = '#0a0a0c';
    cx.fillRect(headX + (face > 0 ? -headR * 0.1 : -headR * 0.8), headY - headR * 0.16, headR * 0.9, headR * 0.2);
    // crest
    cx.fillStyle = p.crest;
    cx.beginPath();
    cx.moveTo(headX - headR * 0.1, headY - headR * 1.1);
    cx.quadraticCurveTo(headX - face * headR * 0.9, headY - headR * 1.5, headX - face * headR * 1.2, headY - headR * 0.5);
    cx.lineTo(headX - face * headR * 0.75, headY - headR * 0.7);
    cx.quadraticCurveTo(headX - face * headR * 0.5, headY - headR * 1.15, headX + headR * 0.1, headY - headR * 1.05);
    cx.closePath();
    cx.fill();
  },
  hardhat(cx, p, g) {
    const { headX, headY, headR } = g;
    cx.fillStyle = p.col;
    cx.strokeStyle = OUTLINE;
    cx.lineWidth = 2.4;
    cx.beginPath();
    cx.arc(headX, headY - headR * 0.16, headR * 0.98, Math.PI, 0);
    cx.closePath();
    cx.fill(); cx.stroke();
    cx.fillStyle = shade(p.col, -26);
    rrs(cx, headX - headR * 1.24, headY - headR * 0.22, headR * 2.48, headR * 0.24, 3);
    cx.fillStyle = shade(p.col, 22);
    cx.fillRect(headX - headR * 0.12, headY - headR * 1.12, headR * 0.24, headR * 0.9);
  },
  deathmask(cx, p, g) {
    const { headX, headY, headR, face } = g;
    cx.fillStyle = p.col;
    cx.strokeStyle = shade(p.col, -70);
    cx.lineWidth = 2;
    cx.beginPath();
    cx.ellipse(headX, headY, headR * 0.95, headR * 1.08, 0, 0, Math.PI * 2);
    cx.fill(); cx.stroke();
    // nemes stripes
    cx.strokeStyle = withAlpha('#2a3a6a', 0.6);
    cx.lineWidth = 2.5;
    for (let i = -1; i <= 1; i++) {
      cx.beginPath();
      cx.moveTo(headX - headR * 0.95, headY - headR * 0.5 + i * 6);
      cx.lineTo(headX + headR * 0.95, headY - headR * 0.5 + i * 6);
      cx.stroke();
    }
    cx.fillStyle = p.eyes;
    for (const s of [-1, 1]) {
      cx.beginPath();
      cx.ellipse(headX + s * headR * 0.36, headY, headR * 0.16, headR * 0.1, 0, 0, Math.PI * 2);
      cx.fill();
    }
  },
  flamehead(cx, p, g) {
    const { neckX, neckY, headR, t } = g;
    // no head — a guttering flame at the collar
    const h = headR * (2.1 + Math.sin(t * 0.22) * 0.22);
    const fg = cx.createRadialGradient(neckX, neckY - h * 0.3, 2, neckX, neckY - h * 0.3, h);
    fg.addColorStop(0, p.core);
    fg.addColorStop(0.45, p.col);
    fg.addColorStop(1, withAlpha(p.col, 0));
    cx.fillStyle = fg;
    cx.beginPath();
    cx.moveTo(neckX - headR * 0.5, neckY);
    cx.quadraticCurveTo(neckX - headR * 0.7, neckY - h * 0.6, neckX + Math.sin(t * 0.18) * 4, neckY - h);
    cx.quadraticCurveTo(neckX + headR * 0.7, neckY - h * 0.6, neckX + headR * 0.5, neckY);
    cx.closePath();
    cx.fill();
  },
  heldhead(cx, p, g) {
    const { shoulderY, shW, torsoH, face } = g;
    const hx = -face * shW * 0.95, hy = shoulderY + torsoH * 0.66;
    ball(cx, hx, hy, g.headR * 0.62, p.col, OUTLINE);
    cx.fillStyle = p.eyes;
    for (const s of [-1, 1]) {
      cx.beginPath();
      cx.arc(hx + s * g.headR * 0.22, hy - g.headR * 0.1, g.headR * 0.09, 0, Math.PI * 2);
      cx.fill();
    }
    // a grin, because it is enjoying this
    cx.strokeStyle = '#2a1a18';
    cx.lineWidth = 1.4;
    cx.beginPath();
    cx.arc(hx, hy + g.headR * 0.12, g.headR * 0.3, 0.3, Math.PI - 0.3);
    cx.stroke();
  },
  hazmathood(cx, p, g) {
    const { headX, headY, headR, t } = g;
    cx.fillStyle = p.col;
    cx.strokeStyle = OUTLINE;
    cx.lineWidth = 2.4;
    cx.beginPath();
    cx.ellipse(headX, headY, headR * 1.06, headR * 1.16, 0, 0, Math.PI * 2);
    cx.fill(); cx.stroke();
    // the tear: starfield showing through
    cx.save();
    cx.beginPath();
    cx.ellipse(headX + headR * 0.1, headY + headR * 0.05, headR * 0.52, headR * 0.42, -0.3, 0, Math.PI * 2);
    cx.clip();
    cx.fillStyle = '#04030a';
    cx.fillRect(headX - headR * 1.2, headY - headR * 1.2, headR * 2.4, headR * 2.4);
    for (let i = 0; i < 10; i++) {
      const tw = 0.3 + 0.7 * Math.abs(Math.sin(t * 0.04 + i * 1.7));
      cx.fillStyle = withAlpha(i % 3 ? '#ffffff' : p.tear, tw);
      cx.fillRect(headX - headR * 0.5 + ((i * 43) % 100) / 100 * headR, headY - headR * 0.4 + ((i * 71) % 100) / 100 * headR, 1.5, 1.5);
    }
    cx.restore();
  },
  rangefinder(cx, p, g, f) {
    const { headX, headY, headR, face, t } = g;
    cx.fillStyle = '#3a4247';
    cx.strokeStyle = OUTLINE;
    cx.lineWidth = 2.4;
    rrs(cx, headX - headR, headY - headR * 0.8, headR * 2, headR * 1.6, 5);
    const irisK = f.state === 'move' ? 0.5 : 1;
    cx.fillStyle = withAlpha(p.col, 0.9);
    cx.beginPath();
    cx.arc(headX + face * headR * 0.24, headY, headR * 0.46 * irisK, 0, Math.PI * 2);
    cx.fill();
    cx.fillStyle = '#0a1418';
    cx.beginPath();
    cx.arc(headX + face * headR * 0.24, headY, headR * 0.2 * irisK, 0, Math.PI * 2);
    cx.fill();
    cx.strokeStyle = withAlpha(p.col, 0.35 + 0.2 * Math.sin(t * 0.16));
    cx.lineWidth = 1.2;
    cx.beginPath();
    cx.arc(headX + face * headR * 0.24, headY, headR * 0.7, 0, Math.PI * 2);
    cx.stroke();
  },
  compoundeyes(cx, p, g) {
    const { headX, headY, headR, face } = g;
    cx.fillStyle = shade(p.col, -30);
    for (const s of [-1, 1]) {
      cx.beginPath();
      cx.ellipse(headX + s * headR * 0.44, headY - headR * 0.1, headR * 0.36, headR * 0.46, s * 0.3, 0, Math.PI * 2);
      cx.fill();
    }
    cx.fillStyle = withAlpha('#ffffff', 0.25);
    cx.beginPath();
    cx.ellipse(headX + face * headR * 0.5, headY - headR * 0.28, headR * 0.12, headR * 0.16, 0, 0, Math.PI * 2);
    cx.fill();
  },
  beastmuzzle(cx, p, g, f) {
    if (f.gset !== (p.set || 'finesse')) return;
    const { headX, headY, headR, face } = g;
    cx.fillStyle = p.col;
    cx.strokeStyle = OUTLINE;
    cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(headX, headY - headR * 0.1);
    cx.quadraticCurveTo(headX + face * headR * 1.5, headY - headR * 0.05, headX + face * headR * 1.5, headY + headR * 0.42);
    cx.quadraticCurveTo(headX + face * headR * 0.8, headY + headR * 0.6, headX, headY + headR * 0.5);
    cx.closePath();
    cx.fill(); cx.stroke();
    cx.fillStyle = p.teeth;
    for (let i = 0; i < 4; i++) {
      const x = headX + face * headR * (0.5 + i * 0.26);
      cx.beginPath();
      cx.moveTo(x, headY + headR * 0.3);
      cx.lineTo(x + face * 3, headY + headR * 0.52);
      cx.lineTo(x + face * 6, headY + headR * 0.3);
      cx.closePath();
      cx.fill();
    }
    // ears
    cx.fillStyle = shade(p.col, -14);
    for (const s of [-0.5, 0.4]) {
      cx.beginPath();
      cx.moveTo(headX + s * headR, headY - headR * 0.8);
      cx.lineTo(headX + s * headR * 1.2, headY - headR * 1.6);
      cx.lineTo(headX + s * headR * 1.7, headY - headR * 0.6);
      cx.closePath();
      cx.fill();
    }
  },
  crown(cx, p, g) {
    const { headX, headY, headR } = g;
    cx.fillStyle = p.col;
    cx.strokeStyle = shade(p.col, -50);
    cx.lineWidth = 1.4;
    const n = p.shards || 4;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i + 0.5) / n * Math.PI;
      const x = headX + Math.cos(a) * headR * 0.92;
      const y = headY + Math.sin(a) * headR * 0.92;
      const h = headR * (p.chitin ? 0.7 : 0.5) * (0.7 + (i % 2) * 0.5);
      cx.beginPath();
      cx.moveTo(x - 4, y + 2);
      cx.lineTo(x + Math.cos(a) * h, y + Math.sin(a) * h);
      cx.lineTo(x + 4, y + 2);
      cx.closePath();
      cx.fill(); cx.stroke();
    }
  },
  headlamp(cx, p, g, f) {
    const { headX, headY, headR, face } = g;
    const on = f.state === 'move' || f.state === 'grabbing';
    cx.strokeStyle = '#2a2e34';
    cx.lineWidth = 3;
    cx.beginPath();
    cx.arc(headX, headY, headR * 1.02, Math.PI * 1.15, Math.PI * 1.85);
    cx.stroke();
    cx.fillStyle = on ? '#fff7d8' : '#8a8478';
    cx.strokeStyle = OUTLINE;
    cx.lineWidth = 1.6;
    cx.beginPath();
    cx.arc(headX + face * headR * 0.1, headY - headR * 0.62, headR * 0.24, 0, Math.PI * 2);
    cx.fill(); cx.stroke();
    if (on) {
      cx.fillStyle = 'rgba(255,247,216,0.1)';
      cx.beginPath();
      cx.moveTo(headX + face * headR * 0.2, headY - headR * 0.6);
      cx.lineTo(headX + face * headR * 3.4, headY - headR * 1.5);
      cx.lineTo(headX + face * headR * 3.4, headY + headR * 0.7);
      cx.closePath();
      cx.fill();
    }
  },
  eyes(cx, p, g) {
    const { headX, headY, headR, face } = g;
    const glow = p.glow;
    const draw = (x, col, r) => {
      if (glow) {
        cx.fillStyle = withAlpha(col, 0.3);
        cx.beginPath(); cx.arc(x, headY - headR * 0.1, r * 2.4, 0, Math.PI * 2); cx.fill();
      }
      cx.fillStyle = col;
      cx.beginPath(); cx.arc(x, headY - headR * 0.1, r, 0, Math.PI * 2); cx.fill();
    };
    draw(headX + face * headR * 0.42, p.col, headR * (p.dead ? 0.1 : 0.13));
    draw(headX + face * headR * 0.06, p.mismatch || p.col, headR * 0.1);
    if (p.dead) {
      cx.strokeStyle = 'rgba(0,0,0,0.4)';
      cx.lineWidth = 1.4;
      cx.beginPath();
      cx.moveTo(headX - headR * 0.1, headY - headR * 0.34);
      cx.lineTo(headX + face * headR * 0.62, headY - headR * 0.28);
      cx.stroke();
    }
  },
  hair(cx, p, g) {
    const { headX, headY, headR, face, t } = g;
    cx.fillStyle = p.col;
    if (p.style === 'long') {
      // falls behind the shoulders — never across the face
      cx.beginPath();
      cx.moveTo(headX - face * headR * 0.92, headY - headR * 0.45);
      cx.quadraticCurveTo(headX - face * headR * 1.5, headY + headR * 1.5 + Math.sin(t * 0.05) * 4,
        headX - face * headR * 0.85, headY + headR * 2.3);
      cx.quadraticCurveTo(headX - face * headR * 0.2, headY + headR * 1.1, headX - face * headR * 0.18, headY - headR * 0.5);
      cx.quadraticCurveTo(headX - face * headR * 0.2, headY - headR * 1.25, headX - face * headR * 0.92, headY - headR * 0.45);
      cx.closePath();
      cx.fill();
      // crown of hair over the skull
      cx.beginPath();
      cx.arc(headX, headY - headR * 0.2, headR * 1.02, Math.PI * 1.02, Math.PI * 1.98);
      cx.closePath();
      cx.fill();
    } else if (p.style === 'tied') {
      cx.beginPath();
      cx.arc(headX, headY - headR * 0.25, headR * 1.02, Math.PI * 1.05, Math.PI * 1.95);
      cx.lineTo(headX + headR * 0.6, headY - headR * 0.5);
      cx.closePath();
      cx.fill();
      cx.beginPath();
      cx.ellipse(headX - face * headR * 1.1, headY - headR * 0.2, headR * 0.3, headR * 0.5, 0.4, 0, Math.PI * 2);
      cx.fill();
    } else {
      cx.beginPath();
      cx.arc(headX, headY - headR * 0.18, headR * 1.03, Math.PI * 1.08, Math.PI * 1.92);
      cx.lineTo(headX - face * headR * 1.0, headY + headR * 0.1);
      cx.closePath();
      cx.fill();
    }
  }
};

// ---------------------------------------------------------------- entry point

export function drawFigure(cx, sim, f, look, t, healFxArr) {
  const g = poseOf(sim, f, look, t);
  const pal = f.char.character.palette;
  g.pal = pal;

  const back = (look.parts || []).filter(p => p.layer === 'back');
  const front = (look.parts || []).filter(p => p.layer !== 'back');

  // depth order — this is what stops a 2D figure reading as a cardboard cut-out:
  // far arm → far leg → torso → near leg → near arm → head
  for (const p of back) { const fn = PARTS[p.type]; if (fn) fn(cx, p, g, f); }
  const kicking = g.mv && g.useLimb === 'LEGS' && g.activeK > 0.2;
  drawArm(cx, g, pal, f, false);
  drawLeg(cx, g, pal, legPose(g, false), -26);
  drawTorso(cx, g, pal);
  if (kicking) drawKick(cx, g, pal);
  else drawLeg(cx, g, pal, legPose(g, true), 6);
  drawArm(cx, g, pal, f, true);
  drawHead(cx, g, pal, f);
  for (const p of front) { const fn = PARTS[p.type]; if (fn) fn(cx, p, g, f); }

  // stance auras
  if (f.state === 'stance' && f.stancePhase === 'hold') {
    cx.strokeStyle = `rgba(201,138,74,${0.4 + 0.2 * Math.sin(t * 0.3)})`;
    cx.lineWidth = 3;
    cx.beginPath();
    cx.arc(0, g.shoulderY + g.torsoH * 0.4, g.W * 1.2, 0, Math.PI * 2);
    cx.stroke();
  }
  if (g.mv && g.mv.parry) {
    cx.strokeStyle = `rgba(255,217,122,${0.5 + 0.3 * Math.sin(t * 0.5)})`;
    cx.lineWidth = 2.5;
    cx.beginPath();
    cx.arc(g.face * g.shW * 0.5, g.shoulderY + g.torsoH * 0.3, g.W * 0.75, 0, Math.PI * 2);
    cx.stroke();
  }

  drawWounds(cx, f, g);

  // accumulated gore
  const totalTrauma = f.trauma.ARMS + f.trauma.BODY + f.trauma.LEGS + f.trauma.HEAD;
  const gore = Math.min(0.4, totalTrauma / 1400);
  if (gore > 0.02) {
    cx.globalAlpha = gore;
    cx.fillStyle = pal.blood;
    torsoPath(cx, g, 0);
    cx.fill();
    cx.globalAlpha = 1;
  }
  // drain flush
  if (healFxArr && healFxArr[f.id] > 0) {
    healFxArr[f.id]--;
    cx.globalAlpha = 0.3 * (healFxArr[f.id] / 22);
    cx.fillStyle = pal.accent || '#b03040';
    torsoPath(cx, g, 0);
    cx.fill();
    cx.beginPath();
    cx.arc(g.headX, g.headY, g.headR, 0, Math.PI * 2);
    cx.fill();
    cx.globalAlpha = 1;
  }
  return g;
}

function drawWounds(cx, f, g) {
  const th = f.balanceRef.trauma.thresholds;
  const wsOf = r => f.trauma[r] >= th[2] ? 3 : f.trauma[r] >= th[1] ? 2 : f.trauma[r] >= th[0] ? 1 : 0;
  const col = ws => ws >= 3 ? '#ff2135' : ws === 2 ? '#b3202e' : '#7a1622';
  const gash = (x, y, len, ws, ang) => {
    if (ws <= 0) return;
    cx.strokeStyle = col(ws);
    cx.lineWidth = ws >= 2 ? 2.6 : 1.6;
    cx.globalAlpha = 0.9;
    for (let k = 0; k < ws; k++) {
      const o = (k - (ws - 1) / 2) * 7;
      cx.beginPath();
      cx.moveTo(x + o, y);
      cx.lineTo(x + o + Math.cos(ang) * len, y + Math.sin(ang) * len);
      cx.stroke();
    }
    if (ws >= 3) {
      cx.strokeStyle = 'rgba(255,33,53,0.35)';
      cx.lineWidth = 5;
      cx.beginPath();
      cx.moveTo(x, y);
      cx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      cx.stroke();
    }
    cx.globalAlpha = 1;
  };
  gash(-g.shW * 0.15, g.shoulderY + g.torsoH * 0.3, g.torsoH * 0.36, wsOf('BODY'), 1.2);
  gash(g.face * g.shW * 0.75, g.shoulderY + g.torsoH * 0.3, g.torsoH * 0.26, wsOf('ARMS'), 1.4);
  gash(-g.W * 0.2, g.hipY + g.legLen * 0.35, g.legLen * 0.3, wsOf('LEGS'), 1.3);
  gash(g.headX + g.face * g.headR * 0.2, g.headY - g.headR * 0.5, g.headR * 1.1, wsOf('HEAD'), 1.1);
}
