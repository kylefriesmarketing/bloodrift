# BLOODRIFT — DECISIONS LOG

Per BUILD_PLAN §5 rule 3: any session that deviates from the three design docs writes the
deviation HERE, so the docs stay truthful for the next agent. Newest first.

---

## 2026-08-04 — Bootstrap session (Fable 5): stack + P1 conventions

**D-001 · Phase A stack = vanilla ES modules (JS + JSDoc) + Canvas 2D, not TypeScript + PixiJS.**
Why: zero build step matches the serve→GitHub Pages pipeline every shipped game in this
workspace uses; the *same* engine modules run headless under node for the determinism
harness (no transpile in CI); removes toolchain risk from session one. What is preserved
untouched from the plan: strict sim/render separation, fixed-timestep 60Hz integer-math sim,
JSON data + schema gate, the effect DSL, "characters are content, not code."
Migration path: schemas are language-agnostic; PixiJS/TS can arrive with the art pass (P2+).
Reversing this is itself a DECISIONS entry.

**D-002 · Input conventions.** EX ("Bloodletting") = hold **Block** while completing a
special's input (costs 1 pint). Flare (ZENITH) = hold **Rift** while completing the input.
Overdrive = **Throw+Rift** with 3 pints. Transfusion breaker = **Block+Throw** during ground
hitstun (2 pints). Wakeup roll = hold **Block** during knockdown (1 pint). Delayed wakeup =
hold **Down**.

**D-003 · Frame data authoring.** `hitstun`/`blockstun` are authored explicitly per move;
`onHit`/`onBlock` in data are the *nominal* advantage assuming first-active-frame contact.
The lint enforces `onHit == hitstun - (active-1 + recovery)` (same for block), so the listed
numbers are always true while meaty contact still improves real advantage. `startup` = frames
before the first active frame (earliest contact = frame startup+1).

**D-004 · GRAFT ships without Harvest at P1** (per BUILD_PLAN §6 P1 note). Borrowed Hands is
simplified to: Rift tap = Power/Finesse set toggle (data-driven stat mods), Rift hold =
Meat Wall stance, graft-limb health = one armor pool (armored moves and Meat Wall consume it;
Meat Wall absorbs projectiles to heal it). This is one of the six sanctioned custom
subsystems from BUILD_PLAN §4.3.

**D-005 · Limb trauma accrues on HIT only** at P1 (no trauma through block). Thresholds and
bleed drip live in `data/balance/core.json`. Wound state 3 applies Bleeding; chip clamps at
1 HP; only bleed drip can finish a round past that clamp (Bleed-out), per GDD §5.3.

**D-006 · Persistence deferred to P4.** Solar Debt and the graft pool run **match-scoped**
(gauges live, in-match effects live); nothing writes cross-match state yet. `rpg_hook.state`
in character.json is the container persistence will hydrate.

**D-007 · Arena interactables deferred** (GDD §3 lists 2–4 per arena). Arena data carries an
empty `interactables` array so the schema is ready; engine ignores it at P1.

**D-008 · Sunders/finishers are STAGED as data, not playable.** `sunders.json` /
`finishers.json` in each character folder carry the roster doc's triggers and cinematic
descriptions with `"cinematic": "TODO"` so P3 is a pure engine milestone, not a data hunt.

**D-009 · Round flow details** the GDD leaves open: meter and limb trauma persist across
rounds; HP refills; Bleeding cleanses at round end (GDD-stated); blood pools persist all
match (GDD-stated). Timer KO = higher remaining HP wins the round; exact tie = both take a
round pip (double KO rule: if that decides the match both ways, the round replays... v1:
tie awards BOTH, match can end 2-2 → sudden-death round with 1 HP... simplified: tie awards
the round to NEITHER and replays. Lint-tested? No — noted here, revisit in playtest).

**D-010 · CPU opponent lives inside the sim** as an optional per-seat controller (pure
function of sim state + its own seeded LCG stream), so CPU matches replay and hash-verify
exactly like human matches.

---

## 2026-08-05 — P3 slice (same bootstrap effort)

**D-011 · Grab range semantics.** `throw.range` / `grab.range` in data = maximum **edge gap**
in px between pushboxes (not center distance). Universal throws 45/50, Fitting 60 (EX 72),
SECONDHAND 80.

**D-012 · Sunders are LIVE with the roster's real trigger conditions**, encoded as structured
`when` objects in sunders.json (schema frozen: `data/schema/sunders.schema.json`, six generic
trigger types reusable across the roster). Cinematics are cinematic-LITE for now: 46f freeze +
bone-cam overlay + heavy blood + announcer; the timeline-data cinematic system (BUILD_PLAN §8)
is still owed. Debuffs implemented per GDD §6: ARMS = −20% damage on ARMS-tagged moves + your
throws tech twice as easily; LEGS = −15% speed + dashes disabled; BODY = meter gain −30% +
Bleeding; HEAD = inputs ghost (25f zero-buffer window after every hit taken). One per region
per match; they persist across rounds. HEAD sunders exist in engine but no launch-pair
character has one authored (matches the roster sheets).

**D-021 · A fourth faction: THE APEX (villains). Roster 15 → 20.** Design doc:
`docs/BLOODRIFT_04_THE_APEX.md`. The original bible has heroes, monsters and aliens — but
the Vanguard "buried most of their roster the day of the Convergence" and nobody in the game
put them there. The Apex are the people who beat the heroes and had their victory interrupted
by the Rift. Four powers now hold four mutually exclusive win conditions over one wound:
close it (Vanguard) / make it pay out (Apex) / keep it open forever (Court) / reopen the way
home (Dominion). ZENITH ↔ SOVEREIGN becomes the roster's central rivalry.
- Fighters: SOVEREIGN (mastermind/counter · Holdings), TERMINUS (juggernaut/escalation ·
  Countdown), HALFLIGHT (dual hero+villain moveset · the Confession, which permanently
  *erodes one half* based on your Execute/Spare record), CHORUS (telepath · Known — she
  learns your most-used move account-wide), KESTREL (mercenary · Contract/Fee — the only
  progression that can go backwards). Hooks were chosen to be new SHAPES, not more
  collect-from-the-defeated variants, of which the roster already had four.
- `data/story.json` is the story surface: codex text plus pre-fight exchanges. Rivalries are
  keyed by the two ids **sorted alphabetically**, and the faction-pair fallback table is keyed
  by **sorted faction** — so line order follows the key, not the seats. ⚠️ Getting that
  backwards silently hands a fighter the *other* one's line; the test asserts both seat
  orders give each fighter their own words, and that all 400 pairings say something.
- ⚠️ TERMINUS never speaks. Its "lines" are bracketed stage directions, not "…", because an
  ellipsis renders as an empty bar.
- The roster generator is now the source of truth for the 15 composed fighters: hand-editing
  their character.json is a change that vanishes on the next `node tools/gen-roster.mjs`
  (MARROW's palette fix was silently reverted exactly this way — the fix belongs in the tool).

**D-020 · The CPU is a reactive fighter, and blocking now pays.** `engine/sim/cpu.mjs` is a
priority ladder — anti-air → whiff-punish → block-on-reaction → okizeme → overdrive →
close-range mixups → footsies → full-screen — with every reactive branch gated behind a
per-level reaction lag. It still "plays the controller" (specials go through the real motion
parser) and still runs on its own seeded stream, so CPU matches replay identically.
- ⚠️ **The reaction gate must key on THREAT IDENTITY, not `o.state`.** Keyed on raw state it
  reset every few frames (idle↔walk flicker), so the timer never expired and the AI never
  blocked or punished at all. Measured before/after: L2-vs-L1 win rate 43% → 82%.
- ⚠️ `comboHits` lives on the VICTIM. Reading the opponent's counter meant the AI never used
  a single Transfusion breaker in a full benchmark (0.0/match).
- **Skill ladder is verified by measurement, not vibes** (28 mirrored matches per pair):
  L3 beats L1 86%, L3 beats L2 79%, L2 beats L1 82%. TIMID also *hesitates* — it stands
  still in bursts — because an easy setting should give the player turns, not just miss more.
- **Balance finding that came out of the benchmark**: a blocking AI could not out-perform a
  mashing one, because defence was pure loss (chip damage + lost tempo + no reward) and the
  2-pint Transfusion comeback was unreachable while under pressure. Defenders now gain
  `meter.blockDefenderGain` (4 centipints) per blocked hit. Re-measured: L3-vs-L2 61% → 71%.
- Impact FX are now hit-type-specific (the sim tags each hit `kind`: punch/kick/proj/grab/
  super + a direction): punches throw a tight star and straight streaks, kicks sweep a
  crescent along the swing, projectiles burst radially, grabs collapse rings inward.
  Audio is layered to match — body tone + surface crack + a wet layer above 45 damage —
  over a tension bed that tightens as the closest fighter nears death.

**D-019 · The art layer is data + three view modules.** `data/looks.json` (schema-free by
design — it is pure presentation, and the sim never reads it) holds each fighter's `build`
proportions and an ordered `parts` list; `engine/fx/body.mjs` interprets them into an
anatomical figure; `engine/fx/draw2d.mjs` holds the shared primitives (lit cylinder limbs,
shaded spheres); `engine/fx/post.mjs` is the composite chain. A new fighter's LOOK is a
data entry, not code — same rule as their kit.
- **Depth order is the rule that makes 2D read as 3D**: far arm → far leg → torso →
  near leg → near arm → head. Far limbs are tone −26 to −30, near limbs +6 to +8.
- Torso is a tapered path (shoulders → waist) with pectoral/ab modelling and a rim light,
  not a rounded rect. Heads are lit spheres with a specular and, when no mask/visor part
  covers them, default eye sockets + brow + jaw so faces aren't blank eggs.
- **Post**: the world renders into a scene buffer, then bright-pass (self-multiply ×2 =
  value⁴, so only genuinely hot pixels bloom) → blur → additive, a soft-light grade, and
  RGB-split chromatic aberration on the heaviest beats only (`punch(k) >= 0.09`: sunders,
  overdrives, executions). Grain is applied AFTER post so it stays crisp.
- ⚠️ Tuning traps found the hard way: bloom above ~0.5 washes the fighters to pale mush;
  aberration on every hit makes the whole frame permanently ghosted; haze layers above
  ~0.1 alpha turn the ruins to mud. All three were captured, diagnosed, and dialled back.

**D-017 · P6 opens with THE GAUNTLET (build plan: "do first").** v1 scope: 7-floor seeded
towers (weekly seed = ISO week, or random), opponents drawn from the roster, CPU level
ramps 1→3, ONE new stacking mutator revealed per floor from floor 2, a draft of 1-of-3
boons after every win (boons persist for the run), profile records clears/best-floor and
every fight still pays XP/mastery through the normal P4 path. The mutator engine is two
generic Sim hooks — `opts.tuning` (global knobs: dmgPermille, bleedMul, meterMul,
poolAcid, startTrauma, plus host-side balance clones for timer/rounds) and `opts.seatMods`
(per-seat: dmgPermille, lifestealAdd, chipImmune, breakerCost, startMeter) — both plain
data, both serialized into the match setup, so mutated/booned fights replay bit-identical.
Mutators and boons live in `data/gauntlet/*.json` (schema-gated). Deferred: leaderboards,
loot-item drops (P4 gear first), Gauntlet-only cosmetic titles.

**D-016 · Schema v1.2 — additive (JOULE).** `rift_button.mechanic` gains `"bank"`
(damage taken converts to Joules at `convertPermille`, cap `max`; Rift-hold = Absolute
Armor stance that banks a full combo, force-exits at `maxHold` frames; grabs beat it).
Moves gain variant key `"charged"` (hold Rift through a special's input to spend
`cost.joules` — the bank's Flare analogue) and `grab.airOnly` (Spot Me catches jump-ins,
whiffs on grounded foes). The stance path is generalized: any character with a
`rift_hold`-triggered move gets a stance; graft_sets absorbs into the graft pool, bank
banks into Joules. Joules persist between matches via the P4 profile (`sig.joules`),
making JOULE the roster's only fighter who banks his losses.

**D-015 · P4 v1 — persistence ships as pure data hydration.** `engine/rpg/profile.mjs` owns
the profile shape (per-character XP/level, W-L, executions/spares, per-move mastery ledger,
signature `sig` state); the HOST owns storage (browser `localStorage['br-profile-v1']`,
tests inject memory). Persistence enters a match only two ways: a REBUILT character bundle
(`hydrateBundle`: max-HP burn from carried Solar Debt at min(debt,15)%, mastery rank-B field
patches + rank-A `ex_adds` from each move's own `mastery.ranks` data) and `Sim opts.sig`
(debt/joules init) — so hydrated matches replay bit-identical given the same profile.
Mastery ranks: score = uses + 3·hits; C/B/A/S at 30/80/180/400. XP: 40/match +40 win
+25 execute +15 spare + damage/40 (cap 30). STRIGOI executions bank vintages by victim
faction. **Tempered** (GDD §7.3) passes null mods — normalized, and results don't record.
Not yet in v1: gear, Dominance trees, loot rolls, level gates, S-rank Desecrations.

**D-014 · Schema v1.1 — additive migration (STRIGOI, Wave 1 opener).** Per rule 1 this is a
ticket, not a silent edit. Additions, all optional/back-compatible: moves.json gains
`lifesteal` (permille of damage/chip healed to the attacker — the Court's drain identity),
`meterSteal` (centipints taken from the victim on hit), trigger type `"rift_press"` (a special
launched by tapping Rift — STRIGOI's Sanguine Draw), and `cooldown` on rift_press moves.
sunders.schema gains `when.type: "pools_drunk"` (after N pools drunk, the next landed hit
sunders). character.json `rift_button.mechanic` gains `"drain"` with config
`{drinkHeal, drinkMeter, drinkRange}` — pool-drinking is engine-generic: pools track a
`drank` bitmask (each fighter can drink each pool once, GDD §5.2/roster). No existing field
changed meaning; v1 data validates unchanged.

**D-013 · FEED THE RIFT ships as the P3 finish window.** Final round ends → 150f slump →
`finish` phase: 480f (8s) window where the winner presses **Rift** to Execute (first execution
from finishers.json is named on screen; the sim spawns a 340-volume pool — the Rift drinks)
or lets it lapse to Spare. Execute/Spare is a sim INPUT → replays/hashes carry it; CPU winners
decide via the seeded rng (~70% execute). Full execution cinematics + the harvest/XP economy
are P4 wiring on this hook.
