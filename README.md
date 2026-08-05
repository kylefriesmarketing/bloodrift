# BLOODRIFT

**▶ PLAY IT: https://kylefriesmarketing.github.io/bloodrift/** (repo
`kylefriesmarketing/bloodrift`, Pages from master root — deploy = `git push origin master`)

**1v1 fighting game × character-driven RPG.** Three realities collide; the Rift keeps score
in blood. Design docs in `docs/` are the spec ([GDD](docs/BLOODRIFT_01_GAME_DESIGN.md) ·
[Roster](docs/BLOODRIFT_02_ROSTER.md) · [Build plan](docs/BLOODRIFT_03_BUILD_PLAN.md));
**this README is the milestone authority**; deviations live in [docs/DECISIONS.md](docs/DECISIONS.md).

## Status (2026-08-05) — P0–P4 ✅ · **FULL 15-FIGHTER ROSTER** ✅ · Gauntlet core ✅ (tower UI pending)

All three factions playable: **Vanguard** ZENITH · TRIAGE · CENTURION IX · JOULE · MARROW —
**Court** STRIGOI · LYCAON · GRAFT · KHET · HARROW — **Dominion** FLUX · VESPRA · ORDNANCE ·
NULL · VYRM. The back ten were composed by `tools/gen-roster.mjs` from lint-proven frame
blocks + hand-specced signature specials (v1 kits — deepen per wave; the six full custom
subsystems from BUILD_PLAN §4.3 are still owed and their identities currently run on the
generic mechanics: sets/audit/rift-specials/drain). KHET's curses = Audit detonation,
LYCAON changes forms, MARROW spends her own HP and walls with bone, HARROW's horse charges,
ORDNANCE mines the floor, NULL teleports and consumes pools, VYRM staples himself back
together. THE GAUNTLET's engine (seeded towers, stacking mutators, boon drafts) is tested
and committed — the tower's menu UI is the next session's first hour.

| Milestone | State | Proof |
|---|---|---|
| P0 skeleton (60Hz fixed-step, deterministic, feels heavy) | ✅ | determinism tests, hitstop/pushback in |
| P1 core duel — ZENITH vs GRAFT, full data-driven kits | ✅ | 2 complete character folders, dial strings, specials, EX/Flare, throws, command grabs, parry, Meat Wall, Overdrives, breaker |
| P2 Living Blood — events → pools → wounds → Bleed-out | ✅ | pools are sim objects that tick meter (amplified on the Rift-Scar), trauma ledger per limb, Bleeding KOs through the chip clamp, arena decals persist all match |
| P3 Sunders + finisher framework | ✅ slice | roster trigger conditions live (structured `when` DSL), persistent debuffs, bone-cam beat, FEED THE RIFT execute/spare window; full cinematics still owed |
| P4 RPG layer | ✅ v1 | **profiles persist** (localStorage): XP/levels, W-L, execute/spare ledger, move MASTERY that patches your moves at rank B+ (your Sunlance chips harder than mine), Solar Debt carries and burns max HP, STRIGOI banks vintages by faction. **Tempered toggle** strips it all (GDD §7.3). Gear/trees/loot still owed (D-015) |
| P5 roster waves | ✅ W1 | **FIVE fighters, four factions of mechanics**: STRIGOI (`drain`: pool-drinking + tether theft), JOULE (`bank`: damage→Joules, Absolute Armor banks combos, Rift-held Discharge variants, joules persist between matches), TRIAGE (`atlas`: Incisions intensify bleeds, Rounds charts the weak limb +12%, Tourniquet cleanse, Clamp samples meter, pool-discounted breaker). Each = one data folder + one generic mechanic. W2 next: MARROW, KHET, ORDNANCE |
| P6 modes (Gauntlet first) · P7 demo ship | ⬜ | |

## Run it

Serve (ES modules need http):

```bash
"C:\Users\kylef\tools\node\node.exe" bloodrift/serve.mjs 8423
```

→ http://localhost:8423/ — pick any pairing of ZENITH / GRAFT / STRIGOI; modes: vs CPU, 2P local, CPU watch.
Controls are on the menu and pause screen (P1: WASD + T/Y/G/H, R throw, F block, V rift).
EX = hold block through a special. Flare = hold rift (ZENITH). Overdrive = throw+rift at
3 pints. Transfusion breaker = block+throw in hitstun. **After the final KO: Rift button
executes — or let the window lapse to spare.**

Tests (the merge gate — BUILD_PLAN §7):

```bash
"C:\Users\kylef\tools\node\node.exe" bloodrift/tests/run.mjs
```

27 tests: schema validation (character/moves/balance/arena/sunders), frame-data lint
(nominal advantage numbers are enforced true), engine purity (no `Math.random` in
`engine/sim/`), golden combos (exact damage/meter/trauma numbers), sunder triggers +
debuff math, execute/spare flows, and three determinism suites (CPU 3600f hash-identical,
scripted replay, full match conclusion).

## Architecture (matches BUILD_PLAN §3, Phase A stack per DECISIONS D-001)

- `engine/sim/` — the deterministic core. Integer math (millipx), seeded LCG, zero DOM.
  `sim.mjs` (FSM, hits, grabs, parry/armor, juggles, rounds, pools, trauma, sunders,
  finish window), `input.mjs` (bitmask + motion parser), `cpu.mjs` (in-sim CPU seat),
  `rng.mjs`.
- `engine/fx/render.mjs` — Canvas2D view (fighters, blood particles → persistent decals,
  pools, Rift-scar, bone-cam, shake/flash). `engine/fx/sfx.mjs` — WebAudio synth.
- `engine/ui/hud.mjs` — vitals bars, blood-bag pints, wound figure, signature gauges,
  announcer.
- `data/` — **the whole game design.** Schemas are FROZEN v1 (changes = migration ticket
  in DECISIONS). A character = one folder: `character.json`, `moves.json`, `sunders.json`,
  `finishers.json`, `gear.json`.
- `main.mjs` — boot/menu/loop/input only. `window.__br` = test hooks
  (`start/step/state/hash/evs/draw`) — matches lose no determinism when driven headlessly.

## Traps for the next session

- **Never touch sim code without re-running the determinism suite.** Anything reading
  `Math.random` in `engine/sim/` fails the purity test by design.
- `onHit`/`onBlock` in moves.json are lint-ENFORCED (`= stun − (active−1+recovery)`).
  Change frames and the lint tells you the new true number; update both.
- The Browser pane won't composite while hidden — verify via `__br` state/events, and
  screenshot via `toDataURL` → the shot receiver (see the Age of Toys CLAUDE.md recipe).
- Grab ranges are edge-gap px (D-011). Sunder `when` types are in the sunders schema
  description (six generic types — reuse them for the roster, don't invent per-character code).
- Old test scripts are frame-timed: if you retune walk speeds or knockback, expect to
  re-space the scripted walk-ins in `tests/run.mjs` (the debug pattern lives in git history).

## Next obvious moves (in build-plan order)

1. **P4 v1**: effect-DSL interpreter growth + Solar Debt / Harvest persistence
   (localStorage profile), Tempered toggle, move mastery XP counting (data already carries
   mastery blocks).
2. **W1 wave**: TRIAGE, STRIGOI, JOULE — pure data folders per the roster doc, one session
   each, schema-gated.
3. Sunder/execution cinematic pass (timeline data files per BUILD_PLAN §8) + real art
   direction beyond capsule-plus.
4. Gauntlet (P6) — the roguelike wrapper is high value/cost.
