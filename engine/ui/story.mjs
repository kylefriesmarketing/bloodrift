// Story surface: the codex, and the pre-fight exchange.
// Pure functions over data/story.json — no DOM, no sim.

// two ids → the intro exchange for that pairing, always something
export function introFor(story, idA, idB, charA, charB) {
  const [first, second] = [idA, idB].sort();
  const flip = first !== idA;
  const key = `${first}:${second}`;
  let lines = story.rivalries[key];
  let personal = true;
  if (!lines) {
    personal = false;
    const fA = charA.faction, fB = charB.faction;
    const [ff, fs] = [fA, fB].sort();
    lines = story.factionPairs[`${ff}:${fs}`] || ['…', '…'];
    // faction table is keyed by sorted faction, so re-orient to the actual seats
    const facFlip = ff !== fA;
    return {
      personal,
      a: { id: idA, line: facFlip ? lines[1] : lines[0] },
      b: { id: idB, line: facFlip ? lines[0] : lines[1] }
    };
  }
  return {
    personal,
    a: { id: idA, line: flip ? lines[1] : lines[0] },
    b: { id: idB, line: flip ? lines[0] : lines[1] }
  };
}

export function buildCodex(story, factions, chars, data) {
  let html = `<div class="cx-title">THE CONVERGENCE</div>
    <div class="cx-body">${esc(story.rift.body).replace(/\n\n/g, '</p><p>')}</div>`;
  html = `<div class="cx-title">${story.rift.title}</div><p class="cx-body">${esc(story.rift.body).replace(/\n\n/g, '</p><p class="cx-body">')}</p>`;

  html += `<div class="cx-sub">FOUR POWERS · FOUR WAYS TO WIN · ONE HUNGRY REFEREE</div>`;
  for (const fk of story.factionOrder) {
    const f = factions[fk], s = story.factions[fk] || {};
    const members = chars.filter(id => data[id].c.faction === fk);
    html += `<div class="cx-fac" style="border-color:${f.col}">
      <div class="cx-facname" style="color:${f.col}">${f.name} <span class="cx-kind">${f.kind}</span></div>
      <div class="cx-theme">“${s.theme || ''}”</div>
      <p class="cx-body">${esc(s.body || f.line).replace(/\n\n/g, '</p><p class="cx-body">')}</p>
      <div class="cx-wants">${f.wants}</div>
      <div class="cx-roster">${members.map(id =>
        `<span><b>${data[id].c.name}</b> <i>${data[id].c.title}</i></span>`).join('')}</div>
    </div>`;
  }
  return html;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
