# BLOODRIFT — GLOSSARY
*(BUILD_PLAN §5 rule 5: consistent vocabulary improves generated content. Use these words, no synonyms.)*

- **Pint** — one unit of Blood Meter. Meter is 3 pints max; internally 300 **centipints**.
- **Bloodletting / EX** — spending 1 pint to enhance a special (hold Block through the input).
- **Flare** — ZENITH-only: supercharge a special by holding Rift; costs 0 pints, adds **Solar Debt**.
- **Solar Debt** — ZENITH's gauge (0–100). +10 per Flare. Persists between matches at P4; match-scoped today.
- **Transfusion** — the 2-pint combo breaker (Block+Throw during ground hitstun).
- **Overdrive** — the 3-pint cinematic super (Throw+Rift). NOON (ZENITH), SECONDHAND (GRAFT).
- **Rift button (RF)** — the 7th button; runs each character's signature mechanic.
- **Living Blood** — the one fluid budget: meter + stage state + damage paint (GDD §5).
- **Blood event** — sim-emitted `{frame, x, y, volume, srcFighter, woundTier}`; fx renders it, sim keeps pools.
- **Pool** — persistent sim object (x, radius, volume). Ticks meter for whoever stands in it; migrates toward the arena's **Rift-scar**.
- **Trauma** — per-limb damage ledger on each fighter (ARMS/BODY/LEGS/HEAD), driven by each move's `limb_tag`.
- **Wound state** — 0–3 per limb region, entered at trauma thresholds. State 3 applies **Bleeding**.
- **Bleeding** — HP drip that CAN finish a round (**Bleed-out** KO). Cleansed at round end. Chip alone can't KO (clamps at 1 HP).
- **Sunder** — condition-triggered cinematic limb break with persistent debuffs (P3; staged in `sunders.json`).
- **Execution** — post-victory finisher, "FEED THE RIFT" window (P3).
- **Desecration** — instant-kill combo ender unlocked at S-rank mastery (P4+).
- **Graft pool** — GRAFT's armor health ("Borrowed Hands"). Armored hits and Meat Wall consume it; Meat Wall absorbs projectiles to refill it.
- **Power / Finesse** — GRAFT's two graft-sets, toggled on Rift tap.
- **Strain / Mass / Curses / the Bank** — later-wave signature resources (FLUX / NULL / KHET / JOULE). Named here so nobody renames them.
- **Tempered / Riftborn** — ranked-normalized vs full-RPG rulesets (P4+).
- **Nominal advantage** — the `onHit`/`onBlock` numbers in moves.json: true for first-active-frame contact, lint-enforced.
