// Command list — generated entirely from a character's moves.json, so every fighter
// (and every future one) documents itself. Shows fighting-game notation AND the actual
// keyboard keys, because notation alone is useless to someone who has never played one.

const KEYS_P1 = { FP: 'T', BP: 'Y', FK: 'G', BK: 'H', TH: 'R', BL: 'F', RF: 'V' };
const KEYS_P2 = { FP: 'I', BP: 'O', FK: 'K', BK: 'L', TH: 'U', BL: 'J', RF: 'N' };
const DIRS_P1 = { f: 'D', b: 'A', d: 'S', u: 'W' };
const DIRS_P2 = { f: '→', b: '←', d: '↓', u: '↑' };

const MOTION_NAME = {
  qcf: 'quarter-circle forward', qcb: 'quarter-circle back', dp: 'dragon punch',
  hcb: 'half-circle back', bf: 'back, forward', dd: 'down, down'
};

// motion → the directional keys you actually press
function motionKeys(motion, seat) {
  const D = seat === 0 ? DIRS_P1 : DIRS_P2;
  switch (motion) {
    case 'qcf': return `${D.d} → ${D.d}${D.f} → ${D.f}`;
    case 'qcb': return `${D.d} → ${D.d}${D.b} → ${D.b}`;
    case 'dp': return `${D.f} → ${D.d} → ${D.d}${D.f}`;
    case 'hcb': return `${D.f} → ${D.d} → ${D.b}`;
    case 'bf': return `${D.b} → ${D.f}`;
    case 'dd': return `${D.d} → ${D.d}`;
    default: return '';
  }
}

function inputFor(mv, seat) {
  const K = seat === 0 ? KEYS_P1 : KEYS_P2;
  const D = seat === 0 ? DIRS_P1 : DIRS_P2;
  const t = mv.trigger || {};
  if (t.type === 'motion') {
    return { notation: mv.input || `${t.motion}+${t.button}`, keys: `${motionKeys(t.motion, seat)} + ${K[t.button]}` };
  }
  if (t.type === 'buttons') return { notation: mv.input || t.buttons.join('+'), keys: t.buttons.map(b => K[b]).join(' + ') };
  if (t.type === 'rift_hold') return { notation: 'hold RIFT', keys: `hold ${K.RF}` };
  if (t.type === 'rift_press') return { notation: 'RIFT', keys: K.RF };
  if (t.type === 'chain') return { notation: mv.input || `…${t.button}`, keys: `then ${K[t.button]}` };
  if (t.type === 'button') {
    const pre = t.pos === 'crouch' ? `${D.d} + ` : t.pos === 'air' ? 'in air ' : t.dir === 'd' ? `${D.d} + ` : '';
    return { notation: mv.input || t.button, keys: pre + K[t.button] };
  }
  return { notation: mv.input || '', keys: '' };
}

function props(mv) {
  const out = [];
  if (mv.guard === 'low') out.push('LOW');
  if (mv.guard === 'overhead') out.push('OVERHEAD');
  if (mv.guard === 'throw') out.push('THROW');
  if (mv.projectile) out.push('projectile');
  if (mv.armor) out.push('armour');
  if (mv.invuln) out.push(mv.invuln.vs === 'air' ? 'anti-air invuln' : 'invincible');
  if (mv.parry) out.push('parry');
  if (mv.knock && mv.knock.type === 'launch') out.push('launcher');
  if (mv.lifesteal) out.push(`heals ${Math.round(mv.lifesteal / 10)}%`);
  if (mv.meterSteal) out.push('steals meter');
  if (mv.incision) out.push('incision');
  if (mv.cleanse) out.push('cleanses bleed');
  if (mv.selfHeal) out.push(`heals ${mv.selfHeal}`);
  if (mv.cost && mv.cost.hp) out.push(`costs ${mv.cost.hp} hp`);
  if (mv.requiresSet) out.push(`${mv.requiresSet} set only`);
  if (mv.cancels && mv.cancels.length) out.push('cancellable');
  if (mv.variants && mv.variants.ex) out.push('EX');
  if (mv.variants && mv.variants.flare) out.push('Flare');
  if (mv.variants && mv.variants.charged) out.push('Discharge');
  return out;
}

const SECTIONS = [
  { key: 'normal', label: 'NORMALS' },
  { key: 'command_normal', label: 'COMMAND NORMALS' },
  { key: 'string_hit', label: 'STRINGS' },
  { key: 'special', label: 'SPECIALS' },
  { key: 'stance', label: 'STANCE' },
  { key: 'overdrive', label: 'OVERDRIVE (3 pints)' }
];

export function buildMoveList(bundle, seat = 0) {
  const ch = bundle.character;
  const K = seat === 0 ? KEYS_P1 : KEYS_P2;
  let html = `<div class="ml-head"><b>${ch.name}</b> <i>${ch.title}</i>
    <span class="ml-arch">${ch.archetype} · ${'★'.repeat(ch.difficulty || 1)}${'☆'.repeat(5 - (ch.difficulty || 1))}</span></div>`;

  const riftText = {
    flare: 'Hold RIFT while doing a special to <b>Flare</b> it — free power now, Solar Debt later.',
    graft_sets: 'Tap RIFT to swap sets. Hold RIFT to enter the stance.',
    drain: 'RIFT drinks a blood pool at your feet, or throws the drain tether.',
    bank: 'Hold RIFT for Absolute Armor (bank the whole combo). Hold RIFT with a special to Discharge.',
    atlas: 'RIFT performs Rounds — charts their most-ruined limb for bonus damage.',
    audit: 'RIFT audits — detonates every curse you have carved into them.',
    rift_special: 'RIFT performs your signature move.'
  }[ch.rift_button.mechanic];
  if (riftText) html += `<div class="ml-rift">🩸 <b>RIFT (${K.RF})</b> — ${riftText}</div>`;

  for (const sec of SECTIONS) {
    const list = bundle.moves.filter(m => m.kind === sec.key);
    if (!list.length) continue;
    html += `<div class="ml-sec">${sec.label}</div><table class="ml-tbl">`;
    for (const mv of list) {
      const inp = inputFor(mv, seat);
      const fr = mv.frames || {};
      const adv = mv.onBlock !== undefined ? (mv.onBlock >= 0 ? `+${mv.onBlock}` : `${mv.onBlock}`) : '—';
      const advCls = mv.onBlock === undefined ? '' : mv.onBlock >= 0 ? 'ml-plus' : mv.onBlock <= -10 ? 'ml-bad' : '';
      const p = props(mv);
      html += `<tr>
        <td class="ml-name">${mv.name}</td>
        <td class="ml-in"><span class="ml-not">${inp.notation}</span><br><span class="ml-keys">${inp.keys}</span></td>
        <td class="ml-num">${mv.damage || '—'}</td>
        <td class="ml-num">${fr.startup !== undefined ? fr.startup : '—'}</td>
        <td class="ml-num ${advCls}">${adv}</td>
        <td class="ml-props">${p.join(' · ')}</td>
      </tr>`;
    }
    html += '</table>';
  }
  html += `<div class="ml-foot">damage · startup frames · advantage on block &nbsp;—&nbsp;
    EX: hold ${K.BL} through a special (1 pint) &nbsp;·&nbsp; Breaker: ${K.BL}+${K.TH} while being hit (2 pints)</div>`;
  return html;
}
