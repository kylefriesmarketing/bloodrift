# BLOODRIFT
### Core Game Design Document — v1.0
*Working title. Alternates: CONVERGENCE, RIFTBORN, BLOOD DOMINION. Trademark-check any title and character name before shipping — several are intentionally punchy one-word names that may collide with existing marks.*

**Genre:** 1v1 Fighting Game × Character-Driven RPG
**Tone:** Dark & brutal. Played straight. Horror-tinged. M17+ (ESRB M / PEGI 18) target.
**Elevator pitch:** Three realities collide — a dying Earth of superheroes, an old-world Midnight Court of monsters, and the invading alien Spiral Dominion. The Rift that merged them feeds on spilled blood, and it rewards the ones who spill it. Every fighter is an RPG character: they level, they loot, and each one has a signature progression mechanic that makes their kills *mean something* — the vampire banks the blood he drains, the flesh golem stitches on the limbs of the fallen, the shapeshifter catalogs alien DNA. Mortal Kombat's spectacle, Diablo's hooks.

---

## 1. Core Pillars

**P1 — Fighting game first.** The RPG layer never breaks the fundamentals: reads, spacing, punishes, execution. Ranked play runs in Tempered Mode (normalized stats) so competitive integrity survives the loot.

**P2 — Blood is a system, not a decal.** Every drop of blood spilled is simulated, persists, pools, and *does something*. Gore is the resource economy, the damage feedback, and the spectacle all at once. (See §5, Living Blood.)

**P3 — Every kill feeds something.** Each of the 15 fighters has a unique persistent mechanic fueled by victory and violence. Execute a beaten foe to harvest what your character craves; spare them to earn story leverage. The player is always making a blood economy decision.

**P4 — Finishers are the fantasy.** Executions are the marquee content: earned, cinematic, character-defining, and unlockable through play like loot. Nobody should see all of them in their first fifty hours.

**P5 — Built to be built by agents.** Every character, move, and RPG effect is data, not code — so Fable 5 and Opus can generate, balance, and expand content in parallel work packets. (See BLOODRIFT_03_BUILD_PLAN.md.)

---

## 2. Story & Setting

### The Convergence
The Spiral Dominion — a stellar empire that strip-mines realities — opened a Harvest Rift over Earth. It malfunctioned. Instead of swallowing one world, it *braided three*: the heroes' Earth, the hidden monster realm called the Midnight Country, and a shard of the Dominion armada itself. Cities now end in cliffs of alien hull. Cathedrals stand fused into skyscrapers. The moon is wrong.

The Rift did not die. It is a wound in reality that clots and reopens, and it drinks. Spilled blood near a Rift-scar doesn't dry — it *migrates*, crawling toward the wound. Whoever feeds it gains its favor: power, resurrection, rewritten flesh. All three factions have learned the same lesson at the same time:

> **The Rift keeps score in blood.**

So they fight. Not armies — armies fed it too fast and birthed the thing called CONFLUX (final boss, §9). Champions. Duels at the Rift-scars, witnessed by all three worlds, where every wound is a wager and every Execution is a tithe.

### The Factions

**THE VANGUARD (Heroes).** Earth's surviving hero coalition. Not shiny anymore — they buried most of their roster the day of the Convergence. The five who fight are the ones willing to get ugly: a dying sun-god, a battlefield surgeon with a kill list, the ninth bearer of a cursed mantle, a demolition man who eats pain, and a woman whose superpower is her own skeleton. Theme: *what heroism costs when the cameras are gone.* Visual identity: broken iconography — cracked emblems, field-repaired suits, triage-tape and scorched capes.

**THE MIDNIGHT COURT (Monsters).** The old predators of the hidden realm, delighted that the walls are down. They are classical monsters — vampire, werewolf, flesh golem, mummy, headless rider — played as apex aristocracy, not jump-scares. They understand the Rift best because they have always run on blood-economies. Theme: *the old world eats the new.* Visual identity: gothic opulence rotted at the edges — bone filigree, funeral silk, candle-light color.

**THE SPIRAL DOMINION (Aliens).** The invaders, now castaways — the Rift severed this armada-shard from the empire, and its five champions fight to reopen the way home (or to rule what's left). Inspired by the Ben 10 fantasy of *alien variety*: five wildly different species/technologies, including a renegade salvager whose stolen implant lets her wear alien forms like weapons. Theme: *the harvest harvested.* Visual identity: bio-mechanical, iridescent chitin, hard-light, wrong geometry.

### Campaign spine (Story Mode, "CONVERGENCE")
Three acts, one per faction perspective, converging on the Rift. Hub-based RPG structure (§7). The connective choice: after every story victory — **EXECUTE or SPARE**. Execute: harvest your character's unique resource (blood, limbs, DNA, skulls, heat...) and feed the Rift, growing your power and the endgame threat. Spare: gain allies, unlock branch quests, starve the Rift. Three faction endings × execution-rate variants. The Rift's final form, CONFLUX, is literally assembled from what players fed it all campaign.

---

## 3. Combat System

**Camera/plane:** 3D-rendered fighters on a 2D plane (MK/NRS style). 1v1, best of 3 rounds, 99-second rounds.

**Buttons:** 4 attack buttons — Front Punch, Back Punch, Front Kick, Back Kick — plus Throw, Block (dedicated button, MK-style), and **Rift** (character-power button used by signature mechanics: STRIGOI's drain, FLUX's form-shift, HARROW's head-toss, etc.).

**Movement:** walk, dash, backdash, jump; no air-dash universals (character-specific exceptions). Deliberate, grounded, footsie-driven pace — heavy hits should feel like verdicts.

**Offense structure:**
- Dial-a-combo strings (2–4 hits) per character, cancelable into specials.
- Specials → EX versions by spending Blood Meter (§5).
- Universal Throw with directional tech; command grabs character-specific.
- **Limb-tagged attacks:** every attack is tagged ARMS / BODY / LEGS / HEAD. Damage accumulates *per limb* on the opponent (drives wounds, Sunders, and several character mechanics). This is the quiet system that makes the gore strategic — see §6.

**Defense structure:** block (chip applies; chip can KO only via Bleed-out, §5), high/low mix, Transfusion combo-breaker (2 pints of Blood Meter), delayed wakeup, roll-away wakeup (costs 1 pint).

**Interactables:** 2–4 per arena, faction-flavored (hurl a pew, detonate a plasma conduit). Destroyed interactables leave debris ORDNANCE can salvage (roster doc).

**Win by:** health KO, timeout, **Bleed-out** (§5), or round-3 finisher states.

---

## 4. Difficulty & Feel Targets

- Time-to-first-cool-moment: under 60 seconds (first Sunder or EX should land in match one).
- Inputs: MK-style motions (down-forward, back-forward etc.), no 360s required for core kits; execution ceiling lives in cancels, spacing, and resource lines, not pretzel inputs.
- Hitstop heavy, camera restrained except Sunders/finishers. Damage feel: 8–12% per opened combo, ~30% for a spent-resource optimal. Matches ~60–120 seconds per round.

---

## 5. THE LIVING BLOOD SYSTEM *(signature system)*

Blood in BLOODRIFT is simultaneously the **super meter**, a **stage element**, and the **damage model's paint layer**. One fluid budget, three jobs.

### 5.1 Blood Meter ("Pints")
A 3-pint meter under each health bar, styled as a blood bag that visibly fills with the *opponent's* blood color (human red, monster black-red, alien ichor — teal, violet, gold by species).

Gain: deal damage (best), take damage (good), stand in blood pools (slow tick), character mechanics (drains, harvests).
Spend: **1 pint** — EX special ("Bloodletting"). **1 pint** — enhanced wakeup roll. **2 pints** — Transfusion combo breaker. **3 pints** — **OVERDRIVE**, the character's cinematic super (each roster entry defines one).

### 5.2 Blood as stage state
Every hit that draws blood spawns persistent fluid: sprays paint the arena and both fighters; heavy hits leave **pools** that spread, merge, and remain all match (they do not despawn — they migrate slowly toward the arena's Rift-scar).

Pools are gameplay:
- Any fighter standing in a pool gains slow meter tick ("the Rift's favor").
- Flagged character interactions (defined per character in the roster doc): STRIGOI can *drink* pools; NULL can *consume* them as mass; TRIAGE's Transfusion is discounted while in a pool; LYCAON's beast-form Frenzy clock feeds on them, etc.
- By late round 2 the arena should read like a crime scene. This is the graphics flex: the fight *writes itself onto the level.*

### 5.3 Wounds & Bleed-out
Fighters visually degrade through 3 wound states per limb region (bruised/torn → lacerated → ruinous: exposed bone, hanging plate, cracked chitin — per-species wound art). Crossing into a limb's third state applies **Bleeding**: a slow health drip that CAN finish a round (KO by Bleed-out has its own animation — the fighter simply… runs out). Bleeding is cleansed by round end, some gear, or character mechanics. Chip damage can only kill through Bleed-out — so turtling at 1 HP against a bleeding wound is a real, dramatic loss condition.

---

## 6. SUNDERS *(X-ray / injury system)*

A **Sunder** is a condition-triggered cinematic strike (one per limb region per character — ~3 each) with bone-cam interior shots: snapping ulna, bursting eye, folding ribs. MK X-ray spectacle — but with **persistent consequences**:

- **Sundered ARMS:** victim's punch damage −20%, throws escapable for free.
- **Sundered LEGS:** victim loses run/dash cancel; movement speed −15%.
- **Sundered BODY:** victim's Blood Meter gain −30%; Bleeding applied.
- **Sundered HEAD:** victim's inputs ghost briefly on hit (concussion micro-delay), directional UI flickers.

Triggers are earned, not spammed: each character's Sunders have listed conditions (e.g., "punish a blocked launcher with this move," "land this counter-hit at max range"). One Sunder of each region per match. In **campaign**, un-treated Sunders persist to the next fight — injuries are RPG state, healed by rest nodes, TRIAGE's clinic, gear, or consumables.

---

## 7. RPG SYSTEMS

### 7.1 The unique layer — Signature Mechanics
Non-negotiable design rule: **every fighter has one persistent progression mechanic no other fighter has**, thematically welded to what they are. These are specified per character in the roster doc. Summary table:

| Fighter | Faction | Signature RPG Mechanic |
|---|---|---|
| ZENITH | Vanguard | **Solar Debt** — overdraw power now, pay max-HP burn later; manage a star's bank account |
| TRIAGE | Vanguard | **Anatomy Atlas** — permanently charts each character's weak points; matchup knowledge as literal data |
| CENTURION IX | Vanguard | **The Relic Armory** — equips relics of 8 dead predecessors; whole move-families as loadout |
| JOULE | Vanguard | **Pain Bank** — damage taken banks as spendable joules across matches |
| MARROW | Vanguard | **Ossuary** — harvests bone from the fallen to craft/upgrade her arsenal |
| STRIGOI | Midnight Court | **The Blood Bank** — banks drained blood as currency; blood *type* matters |
| LYCAON | Midnight Court | **The Hunger Moon** — a real lunar cycle that waxes/wanes his power every match played |
| GRAFT | Midnight Court | **Harvest** — stitches on one stolen move per unique character defeated |
| KHET | Midnight Court | **Ledger of Ages** — his curses persist on opponents across rematches |
| HARROW | Midnight Court | **Head Count** — collects and equips the heads of the fallen for stolen passives |
| FLUX | Spiral Dominion | **The Codex** — collects alien DNA to unlock/level shiftable combat forms |
| VESPRA | Spiral Dominion | **The Brood** — her summons survive, metamorphose, and grow between matches |
| ORDNANCE | Spiral Dominion | **The Proving Ground** — its arsenal is loot: weapons level through recorded trials, printed from banked battlefield salvage |
| NULL | Spiral Dominion | **Event Horizon** — feeds mass to a growing singularity that empowers, then endangers, its keeper |
| VYRM | Spiral Dominion | **Wardrobe of Flesh** — wears the bodies of defeated characters as stat-hybrid "suits" |

### 7.2 Universal progression
- **Fighter Level 1–30.** XP from all modes. Levels gate skill points and gear tiers; they do NOT raise raw stats past Lv10 (stat growth front-loaded; later levels buy *options*, keeping casual matchmaking sane).
- **Dominance Trees.** Per fighter: two signature branches (e.g., LYCAON's *Man* vs *Beast*) + one shared faction branch (Vanguard: Resolve; Court: Dread; Dominion: Ascension). Respec is cheap and encouraged.
- **Gear — 3 slots** (Arms / Body / Relic), rarity Common→Rare→Epic→Mythic→**Riftforged** (set items with build-around powers). Affixes range from stats to *moveset modifiers* ("your bone spear splits at max range," "Overdrive costs 2 pints, damages you 5%"). Gear drops from all modes; finisher kills roll better loot ("the Rift pays for showmanship").
- **Move Mastery.** Every special ranks D→S through use. Ranks add properties (D: base → B: chip/meter tweak → A: new property, e.g. armor on EX → S: unlocks that move's **Desecration**, see §8). Mastery makes "your" STRIGOI different from mine even at equal level.
- **Rift Rank.** Account-level prestige track; cosmetic + finisher unlock currency ("Tithe").

### 7.3 Competitive guardrail — Tempered Mode
Ranked and tournament lobbies run **Tempered**: stats normalized, gear affixes disabled (cosmetics stay), Dominance Tree limited to a curated "legal" node list, Signature Mechanics run in *match-scoped* form only (e.g., STRIGOI still drains in-match; his banked account doesn't apply). Casual, co-op, and PvE modes run **Riftborn** (full RPG chaos). Two clean rule-sets, no half-measures.

---

## 8. FINISHERS

### 8.1 Executions (fatalities)
Win condition state: final round victory by KO/Bleed-out → opponent slumps, the Rift dims the arena, blood pools glow and crawl toward the loser — **"FEED THE RIFT."** 8-second input window.
- 2 per character at launch (specified in roster doc), each ~7–12 seconds, in-engine, character-defining.
- Additional Executions ship as unlockables — loot, campaign branches, Rift Rank Tithe. Finishers ARE the endgame loot table.
- Performing an Execution = feeding the Rift: bonus XP/loot roll + your Signature Mechanic's harvest (GRAFT takes a limb, FLUX samples DNA, HARROW takes the head...). **Sparing** (walk away / mercy input) = smaller XP, story/alliance currency in campaign, and certain "clean hands" tree nodes only unlock via spares. The economy forces the question every match: *what do I need more?*

### 8.2 Desecrations (brutalities)
Instant-kill combo enders unlocked by S-rank Move Mastery (§7.2) — the match "just ends" mid-combo in a shock of violence with a freeze-frame stinger. One per special move, discoverable, no cinematic — pure earned disrespect.

### 8.3 Sunders
Mid-match cinematic injuries; see §6. (Marketing shorthand: X-rays that leave scars.)

### 8.4 Overdrives
The 3-pint cinematic super (§5.1) — safe-ish, high-damage, always available as a comeback valve; each is a mini character showcase.

---

## 9. Boss: CONFLUX, THE RIFT-MADE-FLESH
Non-playable final boss. A cathedral-sized amalgam the Rift built from everything fed to it — hero emblems fused into monster bone over alien chassis, dozens of donor faces, all three factions' silhouettes readable in its body. **Its moveset is literally assembled from the roster:** it steals one signature move from each fighter the *player* used most, plus corrupted Sunders. In campaign, its final form reflects your Execute/Spare ledger — a blood-glutted titan (heavy, gore-armored) or a starved, screaming skeleton-rift (fast, desperate). Beating it with an Execution vs a Spare selects the ending stinger.

---

## 10. Game Modes

- **CONVERGENCE (Story Campaign).** 8–10 hr hub-based RPG: three faction hubs (Vanguard triage-tower, Court necropolis, Dominion wreck-citadel), node-map missions, side quests from roster NPCs, Execute/Spare branching, persistent injuries, loot, and boss CONFLUX. Party framing: you swap between your faction's 5 fighters; benched fighters heal Sunders.
- **THE GAUNTLET.** Roguelike towers: 6–12 fights with stacking modifiers (mutators like "all wounds start lacerated," "blood pools are acid"), draft temporary boons, keep loot. Weekly seeded Gauntlet with leaderboards.
- **VERSUS / ONLINE.** Local + rollback netplay. Casual = Riftborn rules (full builds). Ranked = Tempered (§7.3). Lobbies with spectator "blood betting" (cosmetic currency wagers).
- **THE MORGUE (Training).** Practice on Rift-reanimated cadavers of the cast. Full frame data display, hitbox view, combo trials that teach each character's real gameplan, Sunder-condition drills.
- **ARCHIVES.** Unlocked Executions/Desecrations replayer, lore codex, wound-art gallery. (The "look what I earned" room.)

---

## 11. Art Direction

**One rule above all: blood is the brightest thing on screen.** The world runs desaturated — ash, bone, gunmetal, candle-glow — and arterial red (and alien teal/violet/gold ichor) is reserved, saturated, almost luminous. Every frame becomes a composition *about* the violence. (Faction accent palettes: Vanguard = tarnished gold/navy; Court = candlelight/black-crimson; Dominion = iridescent oil-slick/hard-light cyan.)

**Style target:** painted realism with graphic-novel edge lighting — think grim key-art brought to life, not photoreal (photoreal gore reads as snuff; *painted* gore reads as opera — and it's achievable by a small AI-assisted team). Heavy rim light, volumetric Rift-glow, film grain in finishers.

**Fighters:** silhouette-first design (each of the 15 must be identifiable as a black shape), 3 wound states per limb region per fighter, severable at 14 rig points for finishers, blood-accumulation shader layer (fights end with both fighters *painted*).

**Camera:** locked and clean in neutral; slow push-ins on Bleeding states; full cinematic language only for Sunders/Overdrives/Executions (impact frames, smash zooms, bone-cam).

**UI:** diegetic-leaning — health bars as vitals (Vanguard EKG / Court dripping wax seal / Dominion glyph-lattice), Blood Meter as filling blood bag, wound states shown on a small anatomical figure beside each health bar (also your Sunder targeting HUD).

---

## 12. Audio Direction

- Score: three faction palettes that *combine per matchup* — broken-brass heroism, funeral choir + bowed strings, granular synth/biophonic clicks. The mix literally duets the two fighters' themes.
- Gore SFX: wet, close-mic'd, slightly *too* detailed; silence is a weapon — Executions cut music at the input flash, letting the sound design carry.
- VO: pre-fight intro dialogues per pairing (rivalry lines in roster doc), pain vocalizations recorded per wound state.

---

## 13. Ratings & Content Guardrails

Target ESRB M / PEGI 18 (Mortal Kombat's lane), avoid AO: all gore is combatant-vs-combatant in consensual/ritual combat framing; no sexual violence, no harm to children or helpless civilians in playable content; victims in finishers are fighters, not bystanders. Include a **Broadcast Mode** toggle (reduced gore for streamers/content creators — pools remain, dismemberment implied off-frame) — it widens who can show the game without diluting the default experience. Default experience: everything on.

---

## 14. Document Map

- **BLOODRIFT_02_ROSTER.md** — all 15 fighters: kits, Signature Mechanics, Sunders, Overdrives, Executions, Desecrations, rivalries, gear.
- **BLOODRIFT_03_BUILD_PLAN.md** — tech stack, data-driven architecture, JSON schemas, frame-data format, phased milestones, and how to divide the build between Fable 5 and Opus.
