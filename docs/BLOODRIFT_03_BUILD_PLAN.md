# BLOODRIFT — BUILD PLAN
### For an AI-assisted build with Fable 5 + Opus — v1.0
*Companion to BLOODRIFT_01_GAME_DESIGN.md and BLOODRIFT_02_ROSTER.md. This doc is written to be pasted into Claude sessions as source-of-truth context.*

---

## 1. Guiding principle: characters are content, not code

The single most important architectural decision: **the engine knows nothing about ZENITH.** It knows how to run a deterministic fighting-game simulation from data files. Every fighter — stats, moves, frame data, hitboxes, RPG hooks, Sunder conditions, gear affixes — lives in JSON. This is what makes a 15-character roster buildable by AI agents in parallel:

- Each character = a self-contained work packet (one folder of data + art) that one model session can own end-to-end.
- Balance passes = data edits, reviewable as diffs, no code risk.
- The RPG layer (gear, skills, mastery) = *modifiers over the same data*, expressed in a small effect DSL (§4.3) — never per-character special-case code.
- New DLC characters ship without engine changes.

---

## 2. Recommended stack

**Phase A — Browser build first** (mirrors the SHORT STAFFED plan: playable browser demo, then a store build).

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript | Strict types keep AI-generated code honest; schemas double as types. |
| Renderer | PixiJS v8 (2D, WebGL/WebGPU) | Fast sprite/mesh renderer, filters for blood shaders, tiny boilerplate. |
| Simulation | Custom fixed-timestep core (60Hz), integer/fixed-point positions | Determinism → replays, and rollback netcode stays possible later. **Keep sim and render strictly separated from day one.** |
| Art path | 3D-rendered-to-sprite OR 2D skeletal (Spine-compatible runtimes) | Painted-realism look from §11 of the GDD; skeletal rigs give you the 14 severance points cheaply. |
| Audio | Howler.js | Simple, reliable. |
| Data | JSON + JSON Schema validation at load | The whole game design lives here. |
| Deploy | Higgsfield browser deploy for the demo | Same pipeline as your other projects; later: Electron/Tauri wrap or a Godot 4 port for Steam. |

**Phase B — Steam build:** either wrap the web build (Electron/Tauri — fine for a 2D fighter) or port the sim core to Godot 4 (GDScript/C#) reusing all JSON data unchanged. Decide after the demo finds its audience; the data-first architecture makes the port mechanical.

**Rollback netcode reality check:** it's the hardest single feature on this list. The deterministic core makes it *possible*; still, scope it as post-demo. Ship local versus + PvE first, add delay-based netplay, graduate to rollback when the sim is proven stable.

---

## 3. Repo layout

```
bloodrift/
  docs/                      # these three design docs — agents read these
  engine/
    sim/                     # deterministic core: input, physics, hit resolution,
                             #   limb-damage ledger, blood-particle *seeds* (render-agnostic)
    fx/                      # blood renderer, pools, decals, wound-state compositor
    fsm/                     # character state machine runner (data-driven)
    rpg/                     # effect-DSL interpreter, progression, loot tables
    ui/
  data/
    schema/                  # JSON Schemas (source of truth, generate TS types)
    characters/
      zenith/
        character.json       # identity, stats, rpg hook config
        moves.json           # full movelist w/ frame data + limb tags
        sunders.json         # triggers + cinematic refs
        finishers.json       # executions, desecration, overdrive
        gear.json            # character-specific gear pool
      triage/ ... (×15)
    arenas/ (×8)
    loot/                    # global affix tables, rarity curves
    balance/                 # tuning constants (damage scaling, meter rates)
  art/  audio/  tests/
```

---

## 4. Data contracts (the part to lock FIRST)

### 4.1 `character.json` (excerpt)
```json
{
  "id": "zenith",
  "faction": "vanguard",
  "archetype": "allrounder",
  "stats": { "hp": 1000, "walkSpeed": 4.2, "dashSpeed": 7.5, "weight": 3 },
  "rift_button": { "mechanic": "flare", "config": { "debtPerFlare": 10, "maxDebt": 100 } },
  "rpg_hook": {
    "id": "solar_debt",
    "persistent": true,
    "state": { "debt": 0 },
    "effects": [
      { "trigger": "match_start", "action": "modify_stat",
        "target": "self.hp_max", "formula": "-min(debt, 15) * 0.01 * base" },
      { "trigger": "round_won", "condition": "flares_this_round == 0",
        "action": "adjust_state", "target": "debt", "delta": -5 }
    ]
  },
  "pool_interactions": [],
  "wound_art": { "arms": 3, "legs": 3, "body": 3, "head": 3 }
}
```

### 4.2 `moves.json` — one move (excerpt)
```json
{
  "id": "sunlance",
  "input": "qcf+FP",
  "type": "special",
  "limb_tag": "ARMS",
  "frames": { "startup": 14, "active": 4, "recovery": 21, "onBlock": -6, "onHit": 8 },
  "damage": 70,
  "chip": 14,
  "meterGain": { "hit": 0.12, "block": 0.05 },
  "hitboxes": "sunlance.boxes.json",
  "projectile": { "speed": 9, "durability": 1 },
  "variants": {
    "ex":    { "cost": "1_pint", "damage": 90, "adds": ["armor_break"] },
    "flare": { "cost": "debt:10", "damage": 95, "adds": ["pierce", "ignite"] }
  },
  "mastery": {
    "xp_per_use": 1, "xp_per_hit": 3,
    "ranks": { "B": { "chip": 18 }, "A": { "ex_adds": ["armor:1hit"] },
               "S": { "unlocks": "desecration:last_light" } }
  }
}
```

### 4.3 The effect DSL (RPG glue)
Every skill node, gear affix, curse, and signature-mechanic rule compiles to the same shape — `trigger / condition / action` — interpreted by `engine/rpg/`. **No RPG feature may ship as bespoke engine code without a written exception.** Samples:

```json
{ "trigger": "on_hit", "condition": "target.limb.arms.trauma > 50",
  "action": "apply_debuff", "debuff": "sundered_arm_ready" }

{ "trigger": "standing_in_pool", "interval_frames": 30,
  "action": "gain_meter", "amount": 0.02 }

{ "trigger": "on_execution", "condition": "victim.faction == 'dominion'",
  "action": "grant_resource", "resource": "blood_bank.dominion", "amount": 1 }

{ "trigger": "match_end", "condition": "self.character == 'joule' && result == 'loss'",
  "action": "adjust_persistent", "target": "pain_bank", "formula": "+damage_taken * 0.10" }
```

The 15 signature mechanics in the roster doc all decompose into this DSL plus, at most, one custom *in-match* subsystem each (FLUX's form-swap FSM, HARROW's head entity, VESPRA's broodling AI, VYRM's phase 2, NULL's mass physics, GRAFT's stolen-move slots). Those six subsystems are the real engine work in the roster; the other nine characters are pure data. **Build order exploits this — see §6.**

### 4.4 Blood as data
The sim emits deterministic *blood events* (`{frame, position, volume, sourceFighter, woundTier}`); the fx layer turns them into sprays, decals, and pool meshes. Pools are sim objects (position + radius + volume) so mechanics can query them (`standing_in_pool`, STRIGOI's drink, NULL's consume) — determinism preserved, spectacle layered on top.

---

## 5. Dividing the work between Opus and Fable 5

Treat the two models as a two-person studio with these docs as the shared brain. Suggested split (adjust to taste as you learn where each shines for you):

**Opus — systems & architecture lane.**
- Owns `engine/`: the deterministic sim, FSM runner, effect-DSL interpreter, blood/pool sim, and the six custom character subsystems (§4.3).
- Writes the JSON Schemas *first* and the test harness *second* (see §7) before any feature code.
- Reviews all balance-affecting data diffs ("frame-data review" role).

**Fable 5 — content & breadth lane.**
- Owns `data/`: generates the 15 character folders from the roster doc — movelists with full frame data, Sunder conditions, gear pools, finisher scripts — one character per session, always validating against schema before hand-off.
- Owns campaign/mode content: Gauntlet modifiers, quest text, intro-dialogue matrix (the rivalry web in Roster Appendix A = the priority list), item flavor text.
- Owns iteration passes: "make KHET's zoning 10% less oppressive against grapplers" style tuning tickets.

**Workflow rules that keep agent output clean:**
1. **Schemas before content.** Nothing writes character JSON until the schema is frozen at v1. Schema changes = a migration ticket, never silent edits.
2. **One character folder per session/PR.** Small, reviewable, self-contained. Paste that character's roster-doc section as the session's context.
3. **The docs are the spec.** When a session must deviate from these three docs, it writes the deviation into `docs/DECISIONS.md` — the docs stay truthful or the next agent inherits lies.
4. **Golden tests gate merges** (§7). An agent's work isn't done until the harness passes.
5. Keep a `docs/GLOSSARY.md` (Pints, Sunder, Desecration, Strain, Mass…) — consistent vocabulary measurably improves generated content.

---

## 6. Phased milestones

**P0 — Skeleton (lock the feel targets).**
Fixed-timestep sim, input buffer, two capsule fighters, walk/dash/jump/block, one hit each, hitstop, health bars. *Exit test: it already feels heavy.*

**P1 — Core duel: ZENITH vs GRAFT.**
Two full data-driven kits (the easy shoto + a grappler exercising throws/armor), dial strings, specials, EX spends, Blood Meter, round flow. These two are chosen because they stress the most systems with the least custom code (GRAFT ships *without* Harvest initially).
*Exit test: a best-of-3 between two humans is fun with no RPG layer at all.* This is the P2 pillar-check: if the fighting isn't good here, stop and fix it.

**P2 — Living Blood.**
Blood events → sprays, persistent pools, pool meter-tick, wound states on rigs, Bleed-out KO. *Exit test: a round-3 arena reads as a crime scene; Bleed-out clutch losses happen and feel dramatic.*

**P3 — Sunders + finisher framework.**
Limb-damage ledger, Sunder triggers/cinematics for the two fighters, persistent-injury debuffs, FINISH THEM state, one Execution each, Desecration hook, Overdrives. *Exit: the full violence loop — Sunder mid-match, Execution at the end — runs in one match.*

**P4 — RPG layer v1.**
Effect-DSL interpreter, levels/XP, one Dominance Tree per fighter, gear slots + loot rolls, move mastery, Execute/Spare harvest hook, Tempered-mode toggle. ZENITH's Solar Debt and GRAFT's Harvest go live here (first persistent hooks — one simple, one subsystem). *Exit: two players with different builds are having provably different matches; Tempered strips it all cleanly.*

**P5 — Roster waves.** Ship in waves of 3, cheapest-first (each wave = mostly Fable 5 data work + at most two Opus subsystems):
- W1: TRIAGE, STRIGOI, JOULE (pure DSL hooks)
- W2: MARROW, KHET, ORDNANCE (crafting/curse/salvage — still DSL-heavy)
- W3: LYCAON, CENTURION IX, VESPRA (form-swap FSM ×2, broodling AI)
- W4: FLUX, HARROW (the two hardest kits: multi-form FSM, head entity)
- W5: NULL, VYRM (mass physics, phase-2) + boss CONFLUX (steals from finished kits — must ship last for free)

**P6 — Modes.** Gauntlet (roguelike wrapper over existing fights — high value/cost ratio, do first), campaign act structure + Execute/Spare branching, The Morgue training tools, Archives.

**P7 — Polish & ship the demo.** Browser demo = P1–P4 content + 6–9 fighters + Gauntlet. Netcode and the full campaign are post-demo, funded by whether the demo hits.

---

## 7. Test strategy (non-negotiable for agent-built code)

- **Determinism test:** record input streams → replay must produce bit-identical sim states. Run in CI on every merge. This single test catches most AI-introduced sim bugs (stray floats, frame-order drift, hidden randomness).
- **Golden combo files:** per character, a set of scripted input sequences with expected damage/meter/frame outcomes. Balance changes update goldens *deliberately*.
- **Schema validation** of all `data/` in CI; a character folder that doesn't validate doesn't merge.
- **DSL property tests:** fuzz effect triggers to prove no effect combination corrupts sim state or desyncs determinism (gear × curses × pools is a big combinatorial space — machine-check it).
- **Frame-data lint:** automated rules like "no special is plus-on-block AND launches AND costs nothing" — encode your balance guardrails so Fable 5's generated movelists get sanity-checked mechanically.
- Feel is tested by humans: keep a `PLAYTEST_NOTES.md` ritual after every wave.

---

## 8. Asset pipeline notes

- Character art: concept → turnaround → rig with 14 severance points + 3 wound overlays per region → animation set (~60 anims/fighter core + cinematics). Wound/blood layers are shader-composited, not baked — one rig serves all gore states.
- Finishers are in-engine cinematics driven by timeline data files (camera track + anim refs + blood-event bursts), so agents can author/edit them as data too.
- Budget honestly: 15 fighters × cinematic load is the project's real cost center. The waves in §6 exist so the game is playable and provable long before the art bill comes due. If you generate concept art/animatics with Higgsfield, do it per-wave, not all upfront — the design will move once real matches start teaching you things.

---

## 9. First session checklist (literally what to do next)

1. New repo, paste the three docs into `docs/`.
2. Opus session: write `data/schema/*.schema.json` v1 from §4 + generate TS types + the determinism harness skeleton. Freeze schema v1.
3. Fable 5 session: generate `data/characters/zenith/` + `graft/` complete folders from the roster doc, validating against schema.
4. Opus session: P0 skeleton to "two capsules trading hits at 60Hz, deterministic replay green."
5. Wire ZENITH/GRAFT data into the FSM runner → you are at P1 with a playable build and the whole plan proven in miniature.
