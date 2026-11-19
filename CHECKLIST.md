# Champions Pokédex — Requirements Checklist

A living log of everything requested + built. Legend: ✅ done · 🔄 in progress · ⏳ planned.

### Official names everywhere, fixed at the source — 2026-11-18
- ✅ **Names come from Showdown, not the slug rule.** Both generators built names with `toDisplayName`
  (split on "-", capitalise), so the app showed "U Turn", "Will O Wisp", "Kings Shield", "Forests Curse",
  "Trick Or Treat", "Kings Rock", "Never Melt Ice", "Good As Gold", "Kommo O", "Mr Rime", "Farfetchd".
  `generate-dataset.mjs` → `officialName` (Showdown's `name` at the pinned commit, then PokeAPI's English
  `names`, then the slug rule — logged): 14 moves, 2 abilities (Good as Gold, Zero to Hero), 5 pages
  (Farfetch’d, Mr. Mime, Kommo-o, Sirfetch’d, Mr. Rime; form conventions kept — "Alolan Ninetales",
  "Toxtricity Low Key"). `generate-competitive.mjs` loads the dex at `sources.showdown.commit` for item
  names (King's Rock, Never-Melt Ice — profile items and item sheets) and the dropped-move fallback.
- ✅ **Partner chips reach the right page AND form.** `teammateLink` bakes `formKey` (322 chips:
  "Mega Charizard Y" opened base Charizard) and resolves PokeAPI's `-breed` naming ("Tauros-Paldea-Aqua"
  opened Kantonian Tauros — Mega Pinsir's #1 partner). The detail footer names a borrowed set with
  `prettySmogonName` ("Competitive data shown for Paldean Tauros (Aqua)", not the raw Smogon name).
- ✅ **Search is punctuation-blind** (`searchKey`, format.ts): the home list and the move filter find
  "u turn" / "uturn" / "u-turn", "mr rime", "kommo o", "farfetchd". `canonicalItem` stays (saved calc
  sets may hold "Never Melt Ice").
- ✅ **Re-bake** (`data:comp` pinned 2026-10 / Reg M-C): pokemon.json 22 leaves (names only);
  competitive.json 337 (14 item names, 322 teammate `formKey`, 1 Tauros slug) — usage, items, spreads,
  benchmarks, verdicts byte-identical. `public/sw.js` VERSION restamped `cpx-d939be4a41b2`.
- ✅ **Verified:** new `names.test.ts` (every move/ability/item/species name = @smogon/calc's table;
  ≥14/2/2/5 slug-rule-differs non-vacuity; chips → page + form; searchKey) fails 5/6 on the old data;
  tsc, lint, 458 tests, status ✓ (33), audit --offline 0 HIGH / 1 MEDIUM (teams salvage), build 277 pages.
- ⏳ Not done, noted: Kantonian Tauros's master page still BORROWS Tauros-Paldea-Aqua's set (asForm —
  `EXCLUDE_FALLBACK` anchors `-paldea$`); fixing it drops that page's master data (owner call).

### Adversarial review of the engine port + data phases — 2026-11-18
An independent pass over both phases below: a 300k-case randomized parity fuzz (every modelled move ×
damage-relevant abilities/items/status/boosts/HP/weather/terrain/screens/crit), the pinned Showdown
champions mod read for every Champions-original ability, and every baked benchmark row recomputed by
independent library code (1207/1207 reproduce). Four defects fixed, each pinned and mutation-checked:
- ✅ **Mega Sol kept the TARGET's Sand SpD / Snow Def boosts.** Showdown's `effectiveWeather()` reads Sun
  for every Pokémon while a Mega Sol holder moves, and those boosts check it (the library-with-Sun proxy
  agrees) — Mega Meganium's Grass hits into Mega Tyranitar in its own Sand read ⅔ of their damage.
- ✅ **Spicy Spray was a no-op.** It burns the user after EVERY hit (onDamagingHit), so a multi-hit /
  Parental Bond user's later physical hits are halved (Guts: ×1.5; Lum/Rawst cure it between hits;
  Fire types, burn-proof abilities, Misty Terrain underfoot are immune). New oracle: the library's own
  per-hit rolls, burned from hit 2 (`spicySprayExpected`), plus a non-vacuity suite.
- ✅ **Grassy Glide ignored its +1 in Grassy Terrain**, so Armor Tail / Queenly Majesty / Dazzling never
  blocked it (Rillaboom 99% Grassy Glide → Farigiraf, #5 × #8). A deliberate library difference; Gale
  Wings stays mirrored (full-HP benchmarks).
- ✅ **Calc: Stored Power / Power Trip double-counted the mirrored boost controls** (Bulk Up +1 read Power
  Trip 100 BP, not 60) — `calcOf` now keeps one stat per control.
- Noted, not changed: Assurance's PB child doubles (game-correct; library bug), and three PB-child
  re-run quirks of the library (Seed re-fire after Seed Sower, Klutz Knock Off, Meteor Beam re-boost) —
  unreachable or ~0% in this format.

### Per-form weights, Z-Mega names, prototype-safe lookups, move-sheet polish — 2026-11-18
Phase 2 of the 2026-10 parity work: the data model and display, on top of the engine port below.
- ✅ **Every form carries its own weight.** `BattleForm.weightKg` (PokeAPI's `/pokemon` entry for the
  form) replaces the base species' weight `calc-data.ts` gave all 84 alt forms — 69 differ (Mega Steelix
  400 → 740 kg, Mega Sableye 11 → 161, Mega Metagross 550 → 942.9, Mega Lucario Z 54 → 49.4), so Low
  Kick / Grass Knot / Heavy Slam / Heat Crash into or from a Mega used the wrong power bracket. The bake
  cross-checks every page/form against Showdown's species (`rosterCheck.weightMismatches`, 339/339 —
  one documented exception, Maushold: PokeAPI's default is Family of Four, Showdown's Family of Three,
  pinned in `WEIGHT_CHECK_EXCEPTIONS`). New `calc-data.test.ts` pins the calc INDEX (the app's real data
  path — `damage.test.ts` builds both engines from the library's species data, which is why the parity
  suite never saw this): per-form weights, the library's weights (only Drampa-Mega / Eelektross-Mega
  lag in @smogon/calc 0.11, plus Maushold), and 6 weight-move parity pins (Heavy Slam from Mega Steelix,
  Heat Crash from Mega Camerupt, Low Kick into Mega Kangaskhan, Grass Knot into Mega Sableye / Mega
  Swampert, Heavy Slam Mega Metagross → Mega Tyranitar), each also proven to MISS with the base weight.
  Benchmarks don't change: they never include weight moves (power null). Status: weight cross-check +
  Mega Steelix canary.
- ✅ **Z-Mega names.** `prettySmogonName` read X/Y only, so "Garchomp-Mega-Z" / "Absol-Mega-Z" /
  "Lucario-Mega-Z" rendered raw in partner chips and KO lists; it now reads any suffix letter, drops a
  gender tag (Meowstic-F-Mega → Mega Meowstic, the one collapsed form), and names Primal, regional
  (Ninetales-Alola → Alolan Ninetales, Tauros-Paldea-Aqua → Paldean Tauros (Aqua)) and Rotom forms the
  way the pages do; Showdown form names (Indeedee-F, Aegislash-Blade) and real hyphens (Kommo-o,
  Porygon-Z) pass through. The Calc's form pills (`/\bX$/` `/\bY$/`) read "Mega" twice for Lucario /
  Garchomp / Absol → `formPillLabel` / `megaTabLabel` in `format.ts` ("Base · Mega · Mega Z"); Calc.tsx's
  helper is a one-line delegate (its ITEMS untouched). Data-driven tests: every ladder name equals the
  page/form's own label; no suffix survives raw in any chip or KO list; no species shows two equal pills.
- ✅ **Prototype-safe lookups** (`Object.hasOwn`): `natureEffect("toString")` returned a function (a nature
  can come from a saved set in localStorage), `abilityMatchupNotes(["constructor"])` returned Object as a
  "note", `defensiveMultiplier` went NaN for a non-type defender, `getTrapWarnings` read Object as a trap
  and an inherited usage %. Unit-tested.
- ✅ **Move sheet: "Always crits".** It said "High crit rate" for Frost Breath / Storm Throw (PokeAPI
  critRate 6) and nothing for Flower Trick (critRate 0). The fact chips moved to `src/lib/move-facts.ts`
  (unit-tested over the whole index); the flag is `damage.ts`'s `alwaysCrits()`, stamped server-side in
  `pokedex.ts` — importing `damage.ts` into the sheet put the whole engine on every Pokémon page
  (+19,854 bytes JS, measured A/B; now 711,973 vs 712,036 without). Screenshots: Frost Breath, Flower
  Trick sheets; `npm run shot` gained `TAP=` (tap a button first, `|` chains) to shoot sheets open.
- ✅ **Newcomers pruned per `roster.json`'s own rule** ("Prune a slug once it has established ladder data")
  as its 2026-09-10 precedent applied it — that prune took every slug with its OWN profile (even 0%
  all-ranks: barbaracle, falinks, mawile) and kept pyroar, whose Mega already had 1.2%. All 29 Reg M-C
  slugs had their own profile in 2026-09 AND 2026-10 → pruned; `newcomers` = [pyroar]. The note now
  states the rule exactly; status checks isNew = the list and warns (⚠) on any newcomer due a prune.
- ✅ **Data polish:** PokeAPI's placeholder 0s → null (power on Chilly Reception, Dragon Cheer, Revival
  Blessing, Shed Tail, Shelter, Snowscape, Spicy Extract, Tidy Up + variable Hard Press; accuracy on
  Dragon Cheer — the sheet showed "Power 0" / "Acc 0"); Milk Drink reads "Heals the user or an adjacent
  ally…" (the mod retargets it; Showdown's text lags — `LOCAL_MOVE_OVERRIDES` with a `staleText`
  tripwire); 38 synthesized item sheets now carry Showdown's text (`itemText`) instead of placeholders
  — the 3 Z stones (also categorized Mega Stones now), 34 Champions-original stones, Leek. Status checks
  for each.
- ✅ **Re-bake:** `npm run data` ×2 byte-identical; diff = form `weightKg` ×84, `weightMismatches: []`,
  `isNew` −29, power/accuracy ×10, Milk Drink text, `itemText`, plus upstream PokeAPI drift on two
  flavor texts (Infernal Parade / Matcha Gotcha: ' → ’). `data:comp` (pinned 2026-10 / Reg M-C): only
  the 38 item entries changed — brackets, benchmarks and meta byte-identical. `public/sw.js` VERSION
  restamped `cpx-6691befff2f2` (commit it with the data).
- ✅ **Verified:** 28 mutations, each restored by sha256 — 13 code (form weight → base, X/Y-only names /
  pills, no gender tag, no regional / Rotom rule, bare lookups ×5, old crit wording, no Base pill), 8
  data-file (Mega Steelix 400 kg, a weightless form, accuracy 0, power 0, Milk Drink text, Z placeholder,
  uncategorized Z stone, roster newcomer) and 7 generator re-bakes (Maushold exception, no form weight,
  `?? null`, no Milk Drink override, stale-text tripwire, no Showdown item text, X/Y stone pattern;
  data byte-identical after each restore) — 28/28 caught. tsc, lint, 430 tests, status ✓ (33 checks, +5),
  audit --offline 0 HIGH / 1 MEDIUM (teams salvage) / 0 LOW, build 277 pages (temporary
  `turbopack.root`, restored byte-identically).
- ✅ 2026-11-18 Maushold (owner call): the page bakes PokeAPI's `maushold-family-of-three` (2.3 kg + its
  sprite) via ROSTER_TO_POKEAPI_POKEMON; WEIGHT_CHECK_EXCEPTIONS is empty; `calc-data.test.ts` no longer
  lists it as a library difference. Re-bake diff: 4 Maushold fields in pokemon.json, nothing else.
- ⏳ Not done, noted (Maushold since fixed, above): `Tauros-Paldea-Aqua` partner chips link to Kantonian Tauros
  and that page borrows the Paldean set (`teammateSlug` has no `-breed` step; `EXCLUDE_FALLBACK` anchors
  `-paldea$`, so `-paldea-aqua` slips past it); @smogon/calc 0.11 lags two Mega weights (no newer
  release needed — the engine follows the baked weights).

### Damage engine: abilities ON, every damage item, three bugs — 2026-11-18
The parity sweep neutralized abilities (Group A), so every unported ability was invisible to it.
- ✅ **New Group C sweep (`damage.test.ts`)** — the top 60 Master+ forms with their REAL top ability, top
  item and ladder spread, top 5 damaging moves (multi-hit / variable / fixed-damage included), into the top
  16 defenders with theirs, then again with each defender's other abilities: **8515 cases, 4508 of them
  other-ability**. The pre-port engine failed **891** (Pixilate/Aerilate/Liquid Voice Hyper Voice, Fairy Aura,
  Armor Tail vs Fake Out, Mega Launcher, Electro Shot's charge +1 SpA, type boosters, Chople Berry, Fire
  Mane); now 0. State the calc has no input for is left at the library's defaults (list in AGENTS.md).
- ✅ **Ported (`damage.ts`, restructured on gen789's order):** the -ate family + Normalize + Liquid Voice,
  Sharpness, Sand Force, Fairy/Dark Aura + Aura Break, Iron Fist, Reckless, Mega Launcher, Strong Jaw, Punk
  Rock (both sides), Steely Spirit, Steelworker / Dragon's Maw / Rocky Payload, Transistor, Hustle, Gorilla
  Tactics, Solar Power, Defeatist, Blaze/Torrent/Overgrow/Swarm (≤⅓ HP), Mold Breaker / Teravolt /
  Turboblaze (the library's ignorable list), Scrappy / Mind's Eye, Fluffy + Long Reach, Dry Skin's Fire
  weakness, Marvel Scale, Grass Pelt, Soundproof, Bulletproof, Armor Tail / Queenly Majesty / Dazzling,
  Klutz, Infiltrator, Cloud Nine / Air Lock, Forecast, Protean / Libero, Analytic, Heavy/Light Metal, Parental
  Bond (child hit + between-hit effects), Skill Link; per-hit multi-hit (Triple Axel 20/40/60, Multiscale and
  berries first hit only, Stamina / Weak Armor per hit). Champions-originals from the pinned Showdown mod:
  **Dragonize, Fire Mane, Mega Sol, Aura Guard, Eelevate**; Piercing Drill / Spicy Spray change no roll
  (Protect isn't modelled — say so). Moves the abilities exposed: Weather Ball, Solar Beam/Blade in weather,
  Brick Break / Psychic Fangs / Raging Bull (screens; Paldean Raging Bull type), Facade / Hex / Infernal
  Parade / Venoshock / Barb Barrage, Payback, Stored Power / Power Trip, Acrobatics (doubles BASE power, so
  Technician no longer applies), Eruption / Water Spout / Flail / Reversal / Hard Press (HP control), Seismic
  Toss / Night Shade / Final Gambit, Flying Press, Shell Side Arm, Meteor Beam / Electro Shot's +1 SpA, final
  Speed for Gyro Ball / Electro Ball (Choice Scarf, Iron Ball, paralysis, weather speed abilities).
- ✅ **Bugs:** Fur Coat read as an ITEM (physical hits into Alolan Persian / Furfrou ~2× too high) → ability;
  Darkest Lariat / Sacred Sword ignore the target's Def stages; `verdictOf` printed "4+ HKO–4+ HKO" (1962 of
  4848 golden fixtures) → one label, `guaranteed: true`. Found on the way: Sheer Force misread 41 moves from
  PokeAPI meta, Reckless missed Wave Crash, Population Bomb / Twin Beam rolled 1 hit — all name-keyed now.
- ✅ **Calc items:** `ITEMS` offers every pool item that changes a roll — 18 type boosters, 18 resist
  berries, Muscle Band, Wise Glasses, Light Ball, Iron Ball (63 entries, all in the pool; Metronome out:
  consecutive uses). Ladder spellings ("Never Melt Ice") map onto the list's, so a preset no longer adds a
  duplicate option.
- ✅ **Benchmarks:** the generator feeds @smogon/calc the real top item (not a 7-item allowlist), the
  library's spelling, genderless mons, Skill Link on the Move, and the Champions-original stand-ins; a new
  test recomputes every baked row with the engine. data:comp (pinned 2026-10 / Reg M-C): 149 of 1226 rows
  moved (+4 −19) — Sylveon Hyper Voice 0/1 → 0/3, Mega Pyroar Heat Wave 0/3 → 2/4, Knock Off into item
  holders; everything else byte-identical.
- ✅ **Verified:** 110 code mutations (each rule reverted, file restored by checksum) — every one fails its
  own pins (unpinned rules found that way — Sheer Force × Electro Shot, Toxic/Flare Boost, Wind Rider, Wonder
  Guard, the between-hit Seed Sower / Sand Spit / Water Compaction / Gooey — got pins); swapping in the old
  benchmarks fails the benchmark test. tsc, lint, 401 tests, status ✓, audit --offline 0 HIGH / 1 MEDIUM (teams salvage) /
  0 LOW, build 277 pages (temporary `turbopack.root`, restored byte-identically).
- ⏳ Not done, noted: Mega forms' weight is the base species' in `calc-data.ts` (Low Kick / Heavy Slam into
  or from a Mega — done in the entry above); crit-stage guaranteed crits (Leek / Super Luck + Scope Lens + high-crit moves) aren't
  rolled; multi-hit / Parental Bond fold correlated rolls (min/max exact, OHKO % approximate); no
  Tailwind / Trick Room / ally-aura / fainted-ally inputs.

### Game data: Serebii → Pokémon Showdown's champions mod (App Store licensing) — 2026-11-18
Owner-approved for the iOS release: Serebii's pages are "All Content is © Copyright of Serebii.net" with no
reuse licence (App Review 5.2.2 wants third-party content "specifically permitted"); Showdown's server repo
is MIT ("Copyright (c) 2011-2026 Guangcong Luo and other contributors"). The pipeline now scrapes NOTHING
from Serebii.
- ✅ **New `scripts/showdown-data.mjs`** — every Showdown file read at ONE pinned commit,
  `PINNED_SHOWDOWN_SHA` = `f827a1d41064e0dec4c19c6ea0394fcf0c23479c` (master, 2026-11-16), recorded in
  `pokemon.json` → `sources.showdown`; `SHOWDOWN_SHA=<sha> npm run data` trial-bakes a bump. The `.ts` data
  files (which also hold battle callbacks) are TypeScript-AST-parsed for literals — nothing downloaded is
  executed; any non-literal is a hard error. Mod inheritance mirrors `Dex.loadData`. Code-only rules are
  mirrored + tripwired verbatim (PP cap/scale in the mod's `scripts.ts`; `learnsetParent`'s champions
  no-prevo guard in `sim/dex-species.ts`) — each tripwire and the literal guard were mutation-tested.
- ✅ **Inventory → replacement.** Per-mon movepool scrape (`pokedex-champions/<mon>`, `SEREBII_SLUG`,
  `VARIANT_SUFFIX`, the page-union ∩ PokeAPI ∪ Showdown+prevo filter, the mainline fallback) → the mod's
  per-form `learnsets.ts`, via Showdown's own lookup for this mod (standalone lists, no prevo walk; Rotom
  appliances ∪ base Rotom adds nothing). `MEGA_FORM_ABILITIES` (Serebii-curated; dead — PokeAPI now serves
  all 11) → Showdown species abilities as the fallback, Showdown text for Champions-original/changed
  abilities. `CHAMPIONS_MOVE_OVERRIDES` (Serebii patch notes) → the mod's `moves.ts` + its PP rule. Item-pool
  cross-check (Serebii's item list) → the mod's `items.ts` (baked `itemPool`, 166 items). Roster/newcomers
  (scraped from Serebii) → verified identical to the mod's `formats-data.ts` legal set on every bake (the 29
  Reg M-C newcomers = exactly what Showdown's "Add Champions Regulation M-C" commit made legal; pyroar is
  the M-B holdover); `roster.json` re-attributed. play.pokemonshowdown.com's unpinned JSON (flags, spread
  targets, fallback moves) → the same pinned files.
- ✅ **Movepool diff (old Serebii-derived vs Showdown): 17 of 255 pages, −59 / +2, every one Showdown's
  way** → `MOVEPOOL_OVERRIDES` stays empty. All 59 removals are a SIBLING form's Champions moves that the old
  union let through (Serebii pages are multi-form unions; the filter only checked MAINLINE learnsets — and
  for Indeedee-F it looked up the male's): Raichu −Calm Mind/Speed Swap (Alolan's), Alolan Ninetales
  −Energy Ball/Quick Attack/Solar Beam (Kantonian's), Persian −Curse/Night Slash, Alolan Persian −Last
  Resort, Hisuian Arcanine −Play Rough, Slowbro −Double-Edge/Power Gem/Toxic, Galarian Slowbro −Scald,
  Tauros −Water Pulse (Paldean Aqua's), Slowking −Toxic, Galarian Slowking −Scald, Hisuian Goodra −Acid
  Armor/Round/Snore/Toxic, Hisuian Avalugg −Flash Cannon/Frost Breath/Hydro Pump/Round/Snore/Surf, Hisuian
  Decidueye −Curse/Psycho Cut, Lycanroc (Midday) −19 Midnight/Dusk moves (Counter, Crush Claw, Fire/Thunder
  Punch, Fling, Focus Energy/Punch, Foul Play, Knock Off, Lash Out, Low Sweep, Mega Kick, Outrage, Payback,
  Reversal, Shadow Claw, Throat Chop, Upper Hand, Uproar), Indeedee-F −12 male moves (After You, Encore,
  Expanding Force, Extrasensory, Gravity, Last Resort, Magic Room, Power Split/Swap, Psychic Noise, Tri
  Attack, Wonder Room). +2: Aegislash **King's Shield**, Trevenant **Forest's Curse** — signature moves
  Serebii's tables lacked. Evidence: PokeAPI's own `champions` version group covers 46 of the 61 changes
  and agrees with Showdown on all 46 (the other 15 are v1.2.0 newcomers it lacks); the learnsets are
  datamined (PR #12114 "waiting on personal data and learnsets"; Male Meowstic fix 2ce4267fcf); all 14 real
  in-game Reg M-B tournament teams stay inside the new movepools (audit 0 LOW). Meowstic is one page for
  both genders → `POOLED_MOVEPOOLS` keeps the female's Extrasensory/Future Sight (no diff).
- ✅ **Silent ladder-data hole found + closed:** competitive `moveUsage` drops moves the move index can't
  resolve, so King's Shield (89% of Aegislash) and Forest's Curse (44% of Trevenant) never showed on their
  pages. Now baked; `meta.droppedMoves` + a status check make any recurrence red.
- ✅ **Champions move patches now applied (were mainline):** PP on Champions' scale for every move
  (8/12/16/20; 410 values changed, e.g. Protect 10 → 8, Fake Out 10 → 12; Revival Blessing keeps 1); power —
  Apple Acid/Grav Apple 80 → 90, Beak Blast 100 → 120, Bone Rush 25 → 30, Fire Lash 80 → 90, First
  Impression 90 → 100, Infernal Parade 60 → 65, Meteor Assault 150 → 170, Mountain Gale 100 → 120, Night
  Daze 85 → 90, Psyshield Bash 70 → 90, Slash 70 → 80, Snipe Shot 80 → 85, Spirit Shackle 80 → 90, Trop
  Kick 70 → 85; accuracy — Clangorous Soul can't miss, Crabhammer 95, Make It Rain 95, Syrup Bomb 90;
  type — Growth Grass, Snap Trap Steel; secondaries — Freeze-Dry can't freeze, Iron Head 20% flinch,
  Moonblast 10%, Dire Claw 30% (text), Make It Rain −2 SpA, Toxic Thread −2 Spe; Milk Drink can target an
  ally; flags — Crush/Dire/Dragon/Shadow Claw slicing, Double Shock punch, Dragon Cheer sound; Showdown
  prose for 32 moves whose mechanics changed (Salt Cure 1/16, Rage Fist resets, Encore 3 turns, King's
  Shield −1 Atk…). The old table's two values (Wish/Strength Sap 8) are the mod's own. KO benchmarks and the
  damage parity test now feed @smogon/calc the baked Champions move (`championsMoveOverrides`): 11 benchmark
  rows moved (Pawmot Double Shock 2/7 → 5/6 OHKO/2HKO via Iron Fist, Mega Absol Z Shadow Claw 2/2 → 3/7 via
  Sharpness, Hisuian Avalugg Mountain Gale 1/7 → 4/8, …), and the sweep regained First Impression (1085 →
  1093 cases, 0 mismatches; mutation-checked — a wrong override turns 8 red).
- ✅ **Abilities:** Healer 30% → **50%** (Audino, Aromatisse, Hatterene), Unseen Fist / Piercing Drill now
  say ¼ damage through Protect, Showdown text for the 7 Champions-original abilities; Run Away (Thievul)
  blocks trapping in Champions but neither source says so → curated `LOCAL_ABILITY_TEXT` citing #12303.
  337/339 forms' ability lists equal Showdown's (Greninja's illegal Battle Bond S-slot and Meowstic's
  pooled Competitive are the 2, both correct here).
- ✅ **Checks:** status — pinned-commit + per-mon learnset provenance, roster = Showdown legal set, per-form
  canary (Indeedee-F/Lycanroc), signature-move canary, PP scale, Calc `ITEMS` ⊆ pool (+ the 7 mainline-only
  items absent), dropped ladder moves; v1.2.0 canaries kept, re-worded. Audit — every ladder item in the
  pool (142/142). All mutation-checked, then restored byte-identically.
- Verified: data ×3 byte-identical re-bakes, data:comp, data:teams (forum gate → salvaged, expected), tsc,
  lint, 132 tests, status ✓ (warns: Lycanroc-Dusk, teams behind), audit --offline 0 HIGH / 1 MEDIUM (= the
  teams salvage) / 0 LOW, build 277 pages (temporary `turbopack.root`, restored).
- ✅ **Floette = Floette-Eternal on the stats side too (independent review, same day).** The page had the
  Eternal learnset/ladder data but PokeAPI's `floette` (Red-Flower) stats 54/45/47/75/98/52 + sprites;
  `ROSTER_TO_POKEAPI_POKEMON` now fetches `floette-eternal` (74/65/67/125/128/92 — PokeAPI files its own
  `champions` learnset there). New bake-time cross-check: every page/form's PokeAPI stats + types vs
  Showdown's species (`sources.rosterCheck.statMismatches`) + a status line; mutation-checked (without the
  mapping it flags exactly Floette, status exits 1; 338/339 already matched). Re-bake diff = Floette's
  stats/sprites only; competitive.json byte-identical, sw.js restamped. An independent Python re-derivation
  of all 255 movepools from the pinned files (line-parsed, Showdown's lookup re-ported) matched 255/255.
- ⏳ Not fixed, noted: `newcomers` still flags the 29 Reg M-C mons that now have ladder data (prune per its
  note — done two entries above). (Calc `ITEMS` lacking the damage items — done in the entry above.)

### Reg M-C 2026-10 ladder data + crit parity repair — 2026-11-17
The scheduled "Refresh battle data" run failed 5 times in a row from 2026-11-02 (issue #55): the first
2026-10 bake turned the damage-engine parity test red.
- ✅ **Why it broke:** Mega Froslass jumped #36 → #16 (4.8% → 11.2%) and picked up Frost Breath (0 → 38%
  of sets), so the sweep sampled an always-crit move for the first time: 8 mismatches, one per top-8
  defender, every roll ≈⅔ of @smogon/calc's (0.64–0.69 per roll). `damage.ts` only crit on `field.isCritical`, which no
  UI control sets, so the calc had NEVER rolled a crit: Frost Breath into Rillaboom read a "70–84% 2HKO"
  that is really a 105–126% guaranteed OHKO.
- ✅ **Crit rule ported (`damage.ts`)** — decided once before any stat is read, as gen789 does: a forced
  crit, an `ALWAYS_CRIT_MOVES` move (Frost Breath / Flower Trick / Storm Throw + Wicked Blow / Surging
  Strikes; by name, since PokeAPI's `critRate` serves Flower Trick as 0) or Merciless into a poisoned
  target — never into Battle/Shell Armor. Three first-port bugs the dead crit path had hidden are fixed
  with it: Choice Band/Specs were gated `!crit` (the library keeps them), negative attack stages weren't
  ignored on a crit, Battle/Shell Armor didn't cancel one. Sniper ×1.5 (6144) added on the library's rung.
- ✅ **Pinned (`damage.test.ts`)** — 20 Group B parity pins (each always-crit move, both Armors, ±attack/
  defense stages, Reflect + Aurora Veil, Choice Band/Specs, Sniper on/off, Merciless on/off/vs Shell
  Armor, forced crit) + a whole-index test that `alwaysCrits` equals the library's `willCrit`.
  Mutation-checked: the pre-fix engine fails 17 (sweep + 15 pins + classifier; the 5 passes are no-crit
  controls), and reverting each rule alone fails exactly its own pins.
- ✅ **Issue #30 — the Reg M-C sample-teams thread exists** (Smogon VGC forum, posted 2026-10-29 by a
  forum moderator: `…regulation-m-c-sample-teams.3790579`, title now prefixed "Pokémon") → in
  `KNOWN_THREADS`.
- ⏳ **…but Meta Teams stay Reg M-B.** Smogon's forum now answers every plain fetch with a JavaScript
  proof-of-work page (HTTP 200, "Checking your browser…"), the M-B thread included, so `data:teams` can't
  read the thread and salvages. The generator now names the gate instead of "layout changed?". Deliberately
  not scripted around (it's Smogon's bot gate): baking M-C teams needs a human call on the source. Issue #30
  stays open, and its "add the KNOWN_THREADS line" advice is now stale.
- ✅ **Data:** Reg M-C 2026-09 → **2026-10** (1,631,943 → 1,649,648 battles). Master+ 299 → 291 profiles,
  all-ranks 333 → 335. Meta: Sneasler #1 (49.9%), Kingambit #2, Basculegion #3, Mega Charizard Y #14 → #4,
  Rillaboom #1 → #5, Garchomp #19 → #7, Mega Dragonite #48 → #12, Mega Froslass #36 → #16, Mega Salamence
  #4 → #20; Mega Golisopod, Milotic and Hisuian Arcanine left the top 20. Movepool drift absorbed: base
  Typhlosion / Samurott / Decidueye shed their Hisuian forms' exclusive moves (Serebii's page is the
  base+Hisuian union; spot-checked Decidueye), plus small adds (Indeedee Wish/Sing/Alluring Voice,
  Squawkabilly Lunge/Seed Bomb, Toxtricity, Slowbro, Alolan Ninetales, Hisuian Avalugg — new PokeAPI
  learnset entries, mostly Legends: Z-A, now passing the multi-form intersection).
- Verified: data:all, status ✓ (warns: Lycanroc-Dusk, teams salvaged), offline + online audit 0 HIGH /
  1 MEDIUM (= the teams salvage; online: 333 usages, 0 mismatched), 132 tests, tsc, lint. `npm run refresh`
  itself exited 1 at `next build` in this worktree (symlinked `node_modules`, see AGENTS.md); the build
  passed (277 pages) only with the temporary `turbopack.root`, so CI's real `npm ci` run is the true check.
- ✅ **Independent review** re-ran the bar + mutation checks (each crit rule alone → only its own pins red).
  It also found the 5 variable-BP Group B pins (Low Kick … Electro Ball) passing VACUOUSLY since they were
  added: the runner's `calcMove.bp !== meta.power` skip compared the library's bp 0 with the baked
  `power: null`. Now compared as `meta.power ?? 0`, so they really assert (all 5 match the library).

### Reg M-C ladder data + refresh-pipeline repair — 2026-10-02
User: "update the app with the latest data — the pipeline doesn't seem to be working."
- ✅ **Why it broke (issue #45):** the 2026-10-01 run auto-detected the first Reg M-C month
  (`gen9championsvgc2026regmc` 2026-09, 1.63M battles) and the damage-engine parity test went red —
  Steel Roller had reached Mega Metagross's top moves, @smogon/calc says it FAILS with no terrain, and
  `damage.ts` rolled full damage. Fixed by porting terrain, not by excluding the move from the sweep.
- ✅ **Terrain in the calc** — `CalcField.terrain` + a Terrain chip row beside Weather: grounded 1.3×
  boosts, Misty/Grassy halving, Psychic Terrain blocking priority (Fake Out) into grounded targets,
  Expanding Force (spread ×1.5), Rising Voltage, Terrain Pulse, Misty Explosion, Seeds (fire + spent).
  Moves that fail outright (Steel Roller, Poltergeist, blocked priority) show **"Fails · reason"**, not
  "No effect" (`DamageResult.fails`). 19 new parity pins vs @smogon/calc, mutation-checked (15 fail on
  the old engine; the 4 that pass are the no-effect controls). Normal Gem moved to @smogon/calc's chain
  position. Baked KO benchmarks stay neutral-field.
- ✅ **Silent data gap — Indeedee-F (#7, 20%) shipped with NO ladder data.** Showdown names
  (`Indeedee-F`, `Indeedee`, `Toxtricity`, `Meowstic-F-Mega`, `Squawkabilly`) never matched the roster's
  PokeAPI slugs, so those pages + every teammate link to them were blank; the warning only scrolled past
  in CI. New `scripts/species-aliases.mjs` (renames + Smogon-POOLED forms → `asForm` "(all forms)" — the
  offline audit caught Toxtricity/Squawkabilly carrying other forms' abilities on the first pass), the
  bake records `meta.unmatched`, and `npm run status` fails on any unclaimed ladder species ≥2%. Now 0
  teammate links without a page.
- ✅ **Teams alarm was one run late (issue #30)** — it ran after `create-pull-request`, which restores
  the pre-run tree, so the run that really salvaged (2026-09-21, Smogon 403) filed nothing and the
  healthy next run filed it. Now read before the PR step; the thread fetch also retries ~2.5 min on 403s.
- ✅ **Data:** Reg M-B 2026-08 → **Reg M-C 2026-09**. Master+ 284 → 299 profiles, all-ranks 302 → 333.
  Meta shift: Rillaboom #1 (46.6%, new), Sneasler #2 (37.1%), Incineroar #3, Mega Salamence #4 (new),
  Kingambit #1 → #5 (47.2% → 25.3%), Indeedee-F #7 (new), Gholdengo #21 → #8, Mega Golisopod #10 (new);
  Sinistcha and Whimsicott fell out of the top 20.
- ⏳ **Meta Teams stay Reg M-B** — Smogon has not posted a Reg M-C sample-teams thread (checked
  2026-10-02: only M-C discussion / speed tiers / teams-of-the-week). Add the `KNOWN_THREADS` line when it
  appears; issue #30 stays open until then.
- ⏳ Lycanroc-Dusk (~1% of M-C) is an unmodeled form — the roster has only base Lycanroc.
- Verified: tsc, lint, 111 tests, build (277 pages), status all ✓, audit (offline + online: 331 usages,
  0 mismatched) 0 HIGH / 1 MEDIUM (= the teams salvage), 375px shots of the calc + Indeedee-F/Toxtricity.

### Battle Calc — full damage calculator — 2026-07-19
User asked for a Pokémon damage calculator (the online-calc experience, in-app): pick two mons,
build their sets, see who OHKOs / what survives. Explicitly chose the **full builder** (edit
EVs-as-Stat-Points, nature, ability, item, move) over an in-battle-minimal read — a deliberate
reversal of the old "team builders out of scope" brief line (updated in AGENTS.md).
- ✅ **Client damage engine** `src/lib/damage.ts` — hand-port of @smogon/calc's gen789 formula
  (base damage, bp/at/df/final mod chains, `pokeRound`, doubles ×0.75 spread, 16-roll, KO verdict +
  OHKO chance). **Ships zero @smogon/calc to the client.** Supports weather, screens, Helping Hand,
  Friend Guard, boosts, burn, Multiscale/Filter/Thick Fat/Ice Scales/Adaptability/Technician/Tough
  Claws/Sheer Force/Choice/Life Orb/Expert Belt/AV/Eviolite + Psyshock/Foul Play/Freeze-Dry/Acrobatics.
- ✅ **`src/lib/stat-points.ts`** — Champions Stat Points ↔ EVs (`EV = min(252, SP×8)`, the app's own
  `parseSpread` rule); UI edits SP, engine consumes EVs → numbers match the baked benchmarks.
- ✅ **`src/lib/spread.ts`** — shared spread-move predicate.
- ✅ **Golden test `src/lib/damage.test.ts`** — computes 300+ real meta matchups with BOTH @smogon/calc
  and `damage.ts`; asserts the 16-roll arrays match **exactly**, plus one case per modeled ability/field.
- ✅ **`/calc` route** — static `page.tsx` builds a compact index (`calc-data.ts`) server-side (raw
  ~2.4 MB dataset stays off the client) → `Calc.tsx` client builder: two mon editors (search-select,
  Base/Mega toggle, ability/item/nature/move, Stat-Point sliders with 66-budget/32-cap, meta-set preset
  load), global weather, per-mon battle-state chips, and a **sticky both-directions verdict** + speed
  order. Deep-linkable via `?a=slug&d=slug`. Home header gets a **Calc** pill beside Teams.
- ✅ **Variable-power moves** — Grass Knot/Low Kick (target weight), Heavy Slam/Heat Crash (weight
  ratio), Gyro Ball/Electro Ball (speed) now computed (`VARIABLE_MOVES` in `damage.ts`, golden-tested
  vs @smogon/calc). Situational ones (Counter/Fissure/Fling/Endeavor) stay "not calculated".
- ✅ **Save & load sets** — `src/lib/calc-sets.ts` (localStorage, tray pattern); per-side **Save**,
  a **Saved sets** list that loads any set into either side (the compare loop).
- ✅ **Send to Calc** — detail-page top bar **Calc** → `/calc?a=<slug>`; OpponentTray **Calc** →
  `/calc?d=<top opponent>` (deep-link seeding via `?a=`/`?d=`).
- Verified: `tsc` + `lint` + **75 tests** + `build` (**247 static pages**) green; 375px screenshots.
- ⏳ Still open: a dedicated compare **matrix** view (defender × many attacker sets at once).

### Meta Teams — top 5 real teams + full details — 2026-07-19
User asked for a "top 5 meta teams" section: real teams players actually use (nothing synthesized),
on the latest data, for players to study and build counters against. New `/teams` page.
- ✅ **Real source, not derived.** Smogon exposes no teams for this format (only per-mon co-usage), so
  the teams come from Smogon's **official "Champions VGC Regulation M-B Sample Teams" thread** (collated
  from TPCi + grassroots events) — each a real team credited to a real player + tournament result.
- ✅ **New `scripts/generate-teams.mjs` (`npm run data:teams`)** — bakes `src/data/generated/teams.json`
  at build (committed → **zero runtime calls**). Fetches the thread + each PokéPaste, parses the sets,
  **joins paste↔team by species set** (position-proof against the thread's off-by-one link ordering),
  resolves each mon's form/types/sprite + current Master+ usage, parses the author/event/placement credit
  and archetype, and **ranks by real tournament pedigree** (footprint tie-break). Salvages the committed
  file on a network blip. `generatedAt` pinned to competitive.json's (keeps `status` date-agreement green).
- ✅ **Mega ability fix:** a paste lists the *pre*-Mega base ability (Showdown convention: "Charizard @
  Charizardite Y / Ability: Blaze"); the card now shows the **Mega's** in-battle ability (Drought / Tough
  Claws) since the member is displayed as the Mega. Audit skips ability/move legality for unmodeled forms
  (e.g. Lycanroc-Dusk → base Lycanroc) to avoid false positives.
- ✅ **UI** (frontend-design skill): `/teams` list = 5 ranked "dossier" cards (rank marker, archetype tag,
  codename, real credit, **formation strip signature** — 6 type-tinted sprites over a spectrum blended from
  their own type colors, so a Rain team reads blue / a Sun team orange) + a "More sample teams" list (all 13
  baked). `/teams/[slug]` = full sets per mon (item/ability/nature/EVs/4 moves) each linking to its scouting
  page. Home header gains a neutral **Teams** entry point. hud-label headings, red stays threat-only.
- ✅ Wired `data:teams` into `data:all` → `refresh` (+ weekly Action). `status` + `audit` gained teams
  checks (6-mon completeness, every member resolves to a roster mon with a full set, form keys valid).
- Verified: `tsc` + `lint` + 50 tests + `build` (246 static pages: +/teams +13 team pages) + `status` +
  offline `audit` (0 findings) all green; 375px screenshots of list + detail checked.

### Data-integrity audit + `npm run audit` — 2026-07-18
User asked to verify no stale/wrong per-Pokémon data (EVs, move %, pick rate, everything) and to
make the "keep data current" process obvious to the next agent.
- ✅ **New `scripts/audit-data.mjs` (`npm run audit`)** — the correctness net `status` lacked. Per
  Pokémon/form it checks: pick rate range, EV spread (nature valid, ≤252/≤508), move %/ability %/item %
  ranges, **that every baked move is in the mon's movepool and every ability is one it can actually have**
  (catches wrong Smogon matches), item/teammate slugs resolve, benchmarks reference real mons + moves,
  stat totals, types. Plus live cross-checks: newest published month/regulation, and every mon's usage
  vs Smogon's **independent** `usage.txt`. Wired offline into `refresh`; exits non-zero on any HIGH.
- ✅ **Finding A (fixed):** 11 Champions-original Megas (Mega Raichu X/Y, Staraptor, Scolipede, Scrafty,
  Eelektross, Pyroar, Malamar, Barbaracle, Dragalge, Falinks) had `abilityUsage:{noability:88,…}` —
  Smogon can't identify their ability. Generator now **folds `noability` into the curated single
  ability** (Mega Raichu X → "Electric Surge 100%", not 12%). 22 profiles corrected.
- ✅ **Finding B (fixed):** Meowstic's ability list was male-only (Keen Eye/Infiltrator/Prankster); the
  1% **Competitive** (female) was missing. Added via `EXTRA_BASE_ABILITIES` (keyed by ROSTER slug, since
  PokeAPI's default variety is `meowstic-male`, not `meowstic`).
- ✅ **Confirmed NOT stale/wrong:** every numeric value (298 usages vs usage.txt: 0 mismatches; EVs, move %,
  ability %, spreads) checks out; data is on the newest month + regulation. The 57 master `usagePct:0`
  profiles are the legitimate 1630-backfill tail (accurate), and `asForm` profiles blank ability/move by
  design — both taught to the audit so they aren't false positives.
- Verified: `status` + offline & online `audit` + tests + build green.

### Deep audit — 33 fixes — 2026-07-17
A 9-dimension multi-agent audit (each finding refuted + reproduced) surfaced 31 issues; plus 2
live-data findings. All fixed in one pass. Highlights:
- ✅ **Kill-shot / pin quad now ability-aware** (`effectiveDefensiveProfile`): Heat Rotom
  (Levitate) no longer reads "4× weak to Ground", Thick Fat demotes a 4× to 2×. Wired into
  ThreatProfileCard + the home/detail pin. Unit-tested.
- ✅ **Threat Profile recognizes Grassy Glide** (static priority 0) → Rillaboom shows its revenge
  vector. ✅ **Speed Scarf+Tailwind** chained in Q12 (101→303, not 302). Both unit-tested (50 tests).
- ✅ **Pipeline guardrails** (the auto-detect I shipped): refuses to downgrade to an older
  regulation/month; won't select a regulation before its 1630/1760 files publish; logs ladder
  species with no roster page; `status.mjs` gained a coverage floor + a KO-benchmark floor.
  ✅ Champions-original Mega Stones (Raichunite X/Y) get a real description (isMegaStone missed
  the "…ite X/Y" suffix).
- ✅ **Service worker**: VERSION now stamped from a data hash (old caches purge on deploy),
  static-cache cap, image cache LRU, captive-portal fallback guard; registrar checks for updates
  on reopen and reloads once (guarded against loops / first-install).
- ✅ **Sheets**: focus-trap, tray goes inert while open (no stacked sheets), wheel/touch scroll
  guard, 44px close targets. ✅ **Home/search**: iOS autocorrect off, autofocus only on first
  session mount, aria-live count, `content-visibility` windowing, newcomer badge kept when ranked,
  44px pin, tray-full no longer silently evicts. ✅ **Detail**: "See whole-ladder read" flips the
  bracket in place; Reg label surfaced; SpeedPanel resets per form.
- ✅ **Dead code removed**: RoleModal + getDoublesRoles/ROLE_TONE/DoublesRole chain (248 lines);
  AGENTS.md map corrected (+type-meta.ts, −doubles roles); README on Reg M-B + reg auto-detect.
- Verified: tsc + lint + test + build + status green; screenshots.

### Reg M-B switch + bottom-sheet rework — 2026-07-17
User report: "no data for some Pokémon that have been out a while" + bottom sheets misbehaving.
- ✅ **Root cause of "no data":** game rotated to **Regulation M-B** (v1.1.0, 2026-06-17) but the
  competitive generator hard-coded `…regma`. The +22 roster mons (added 2026-06-18) had pages but
  no ladder data because they only appear in the M-B stats. Confirmed: 38 of 40 dataless forms are
  present in Smogon's `…regmb` files.
- ✅ **Fix:** `generate-competitive.mjs` now **auto-detects the current regulation AND month**
  (reads each month's chaos index newest-first, takes the highest-lettered `…regm*`; `.sort().at(-1)`
  tracks release order). Pins: `STATS_FORMAT` / `STATS_MONTH`. Re-baked → master **244 → 280**
  profiles, all **264 → 300**; Mega Swampert 14.6%, Mega Metagross 13.9%, Grimmsnarl 14.7%,
  Gholdengo 11.6%, Mega Raichu X/Y 1.7/9.5% — all previously blank, now populated. Status all green.
- ✅ **Bottom-sheet rework** (`Sheet.tsx`, new): all sheets (Move/Item/Briefing/Role) now **portal to
  `document.body`**, fixing the PWA bug where the deep-in-the-DOM MoveModal never appeared and the
  shallow ItemModal covered the footer — web + installed-PWA now behave identically. Sheets rest
  **above** the opponent tray via `--tray-height` (published by `OpponentTray`); **footer always
  visible, never covered** (per user). Dropped the `overflow:hidden` scroll-lock (it killed the
  tray's `sticky` and caused the page shift/jump) in favor of scrim `touch-none` + panel
  `overscroll-contain` + `focus({preventScroll})`. Verified at 375px with a seeded opponent:
  sheet bottom == footer top, footer fully visible for both move + item sheets.
- ✅ tsc + lint + `npm test` (42) + build (232 pages) green.

## Foundation
- ✅ Latest **Next.js 16** (App Router, Turbopack), TypeScript, Tailwind v4, mobile-only
- ✅ **Very fast** — all data baked in at build; every page static; **zero runtime API calls**
- ✅ Purpose: a **mid-battle helper** for Pokémon Champions (doubles)

## Roster & data
- ✅ Exact **Serebii Champions roster**
- ✅ **Champions Megas** validated (incl. new ones like Mega Dragonite/Greninja)
- ✅ **Regional + Rotom forms split out** as distinct entries (Alolan/Galarian/Hisuian/Paldean,
  Wash/Heat/Frost/Mow/Fan Rotom) — own typing/stats/abilities/movepool/competitive data
- ✅ Moves = the **actual Champions movepool** (Serebii) with full battle data (PokeAPI)
- ✅ **Competitive data = Champions DOUBLES ladder**, per-form. Regulation + month **auto-detected**
  (see 2026-07-17 entry); currently `gen9championsvgc2026regmb` (Reg M-B), 2026-06, 1.16M battles

### Roster update — 2026-06-18 (22 new species)
- ✅ **+22 species** Serebii added to Champions: annihilape, barbaracle, blaziken, dragalge,
  eelektross, falinks, gholdengo, grimmsnarl, houndstone, malamar, mawile, metagross, musharna,
  overqwil, pyroar, qwilfish, sceptile, scolipede, scrafty, staraptor, swampert, vileplume
  (roster 204 → **226**). Found by re-diffing the Serebii roster page against `roster.json`.
- ✅ **Movesets from the Champions source** — each mon's movepool verified to match its Serebii
  `pokedex-champions` page **exactly** (count + every slug). Not mainline movepools.
- ✅ **Megas checked, none missed** — 14 of the 22 carry a Mega (Barbaracle, Blaziken, Dragalge,
  Eelektross, Falinks, Malamar, Mawile, Metagross, Pyroar, Sceptile, Scolipede, Scrafty,
  Staraptor, Swampert); reconciled across Serebii + PokeAPI.
- ✅ **Mega abilities recovered** — PokeAPI serves 9 Champions-original Megas ability-less;
  `MEGA_FORM_ABILITIES` curates them from Serebii, incl. Champions-only **Eelevate** (Mega
  Eelektross) and **Fire Mane** (Mega Pyroar). `status.mjs` now asserts every form has an
  ability + effect text.
- ✅ **No ladder data yet** (too new for Smogon) — the detail page shows stats/types/abilities/
  full movepool/speed bounds/matchups with an honest "No Champions ladder data for this form yet."
  note; no fabricated 0% anywhere (verified by a 25-agent adversarial pass).
- ✅ **NEW badge + "New to Champions" filter** — `roster.json` `newcomers` → generator stamps
  `isNew`; cyan badge on the home card (where the pick-rate rank sits) and the detail hero, and a
  home filter that narrows to exactly the 22. Cyan, never red (red = threat only).
- ✅ **Hisuian Qwilfish — confirmed NOT in Champions, correctly base-only.** The Serebii roster
  page lists included regional forms by sprite suffix (`-h` Hisuian, `-a` Alolan); the 7 `-h`
  sprites present (059/157/503/571/706/713/724) match the existing `-hisui` roster entries exactly.
  Qwilfish (#211) has only `211.png`, no `211-h` → not in the game, so not added. Overqwil (#904,
  its evolution) is its own species and is in.

## Home screen
- ✅ Search — **prefix match on name or base species** (`rotom` → all Rotom forms)
- ✅ **Sorted by doubles pick rate** (most likely to face first)
- ✅ Clean **Pokémon HOME render icons**; real transparent **Mega Evolution badge** (bright white glow) by the pick rate
- ✅ **Tap the Mega badge → opens the detail with the Mega form already toggled** (deep-link)
- ✅ Type-colored card accents; pick-rate %

## Mid-battle upgrades (from the multi-lens review)
- ✅ **Likely set** — top moves by ladder usage shown above the fold (no longer buried)
- ✅ **Spread-move tags** on move rows ("Both foes" / "Spread") — doubles-defining
- ✅ **Lv. 50 stat column** — each stat's clean **neutral** L50 value (no EVs/nature folded in), with a
  lighter **shadow on the bar** showing the common spread's EV investment (connected + rounded ends) and a
  **`+N` indicator** above each light bar = exactly what the EVs add at Lv 50 (e.g. 252 EV → +32).
  Audited across all 265 forms; nature shown as text below, not baked into numbers
- ✅ **Doubles role chips** — each chip names the *specific* move/ability this Pokémon runs, never a
  generic word: Fake Out · Follow Me / Rage Powder · Trick Room · Tailwind · the screen it sets
  (Aurora Veil / Dual Screens / Reflect / Light Screen) · its pivot (U-turn / Volt Switch / Flip Turn /
  Parting Shot) · its priority move (Extreme Speed / Bullet Punch / Sucker Punch / Aqua Jet / …) ·
  Intimidate · weather. **Tap any chip → modal** with a doubles overview of what it does and how to play around it
- ✅ **Home ranks by the Mega's usage** (Charizard now 14%, not 0.2%) — top threats surface
- ✅ **Recovered dropped moves** — Alolan Ninetales' Aurora Veil/Freeze-Dry now show (move union)
- ✅ Fixed: Alolan Raichu's fake Mega tabs; all 535 moves now have effect text; default to the
  form that has data (Meganium → Mega); tap-affordance chevrons; 0% vs <1% distinction

## Pokémon detail screen
- ✅ **Stats** + colored read + **Lv. 50 column** + **common spread & nature** (with ↑/↓ stat effect)
- ✅ **Abilities** with usage % (Most-used flagged, sorted)
- ✅ **Common Items** (top 3 + %, Most-used flagged, red outline) → **tap for full item modal**
  (every item has a description; PokeAPI-missing ones like Fairy Feather are filled in)
- ✅ **Moves**: two-line rows (no cutoff), **Common** filter w/ usage %, priority/category;
  **tap → modal** with target, secondary chances (flinch/stat/ailment %), full effect, hits
- ✅ **Watch for set-up** callout (Swords Dance, Calm Mind, …) — placed **right above the move set**
- ✅ **Common Partners** (linked, top one highlighted)
- ✅ **Mega / form toggle** (per-form types/stats/abilities/competitive)
- ✅ Sticky bar: **Back = previous Pokémon**, centered **Home button** (Pokémon-Center style)
- ✅ Removed Physical + the old standalone "Competitive" section (data woven throughout)

## Performance (40-second turn clock)
- ✅ Every page **statically prerendered** (`/` static, all `/pokemon/[name]` SSG) — no runtime API
- ✅ **Routes prefetched as cards scroll into view** — Next `<Link>` default viewport prefetch warms
  the full static RSC payload, so tapping a visible Pokémon navigates with near-zero latency (prod ~80ms).
  Verified on a prod build: 10 RSC prefetches on load → 65 after scrolling (**prefetch is prod-only —
  `npm run dev` never prefetches**)
- ✅ **Hero artwork prefetched too** — each card warms its detail artwork (base + Mega) via an
  IntersectionObserver when it scrolls near the viewport; the hero is served `unoptimized` (direct CDN)
  so the prefetched URL is a cache hit on tap. Verified: 13 on load → 50 after scrolling
- ✅ Verified the **dataset never ships to the client bundle** (baked into each page at build; the
  client chunk is ~45 kB of component code, not the JSON) — keeps first-load JS tiny
- ✅ Mega deep-link (`?form=`) applied in a **pre-paint layout effect** → correct on full load and
  client nav, no flash, no hydration mismatch

## Polish / UX
- ✅ Smooth font (Manrope); compact, glanceable layout; no horizontal overflow
- ✅ A11y on modals (focus trap-in/restore, scroll lock, labelled dialog) — moves, items, **roles**
- ✅ Fixed duplicate-key bug (forms share dex numbers) and form-bleed in competitive data
- ✅ Fixed the Mega badge painting over the sticky search bar (`isolate` contains its z-index)

## Wave 2 (threat detection + fresh data)
- ✅ **Threat Profile card** — a per-Pokémon threat read at the top of every detail page. An
  engine (`src/lib/threat.ts`) classifies each form's threat vectors from the ladder data and
  fires only what's true for THAT Pokémon, ranked by severity: set-up sweeps (post-boost stats
  actually computed, e.g. "Atk 205→410"), raw damage as a **meta percentile** ("hits harder than
  83% of the meta"), Trick Room / Tailwind / speed drops, priority revenge-killing, disruption
  (sleep, Fake Out, Encore, redirection, item theft), **ability traps** (Defiant / Levitate /
  Magic Bounce / absorbs — the anti-misclick layer), tank profiles, and Scarf/speed tiers. Each
  card gets an archetype line ("Revenge killer · Punisher") and move-backed rows tap through to
  the move sheet. All computed server-side at build — zero extra client payload
- ✅ **Type Matchups card** (bottom of the page, per request) — 4× called out loudly, weak /
  resists / immune; verified at 375×650 (stacked label block so nothing overlaps)
- ✅ **Master+ / All ranks toggle** — both brackets fully baked into every static page; a
  persistent client-side toggle (home header + detail pages, **defaults to Master+**) switches
  pick rates, sort order, likely sets, spreads and threat profiles instantly with zero network.
  Master+ = 1760 backfilled from 1630 only (8 backfilled; 18 rare mons show a "switch to All"
  hint); All = whole ladder. Top-bracket play reads genuinely differently (e.g. Incineroar:
  "Disruption · Tank" at Master+ vs "Wallbreaker" on the whole ladder)
- ✅ **Weighted-denominator fix** — high-cutoff chaos files weight the Moves/Teammates/Spreads
  tables but not "Raw count"; per-set rates now divide by the weighted set count (the Abilities
  sum), which the raw-count math had silently zeroed at 1760
- ✅ **Form-correct movepools** — variants scrape the base species' Serebii page intersected with
  the form's learnset from PokeAPI ∪ Showdown **including pre-evolutions** (egg/prevo moves like
  Hisuian Arcanine's Head Smash survive); Tera moves excluded; Champions-new moves recovered from
  Showdown; move flags baked; pipeline salvages from the committed dataset when PokeAPI 5xxs
- ✅ **Freshness stamp** — both generated files carry `generatedAt`; the home header shows
  "204 Pokémon · updated Jun 11"
- ✅ **Always-fresh snapshots** — `npm run data:comp` auto-detects the newest published Smogon
  month (pin with `STATS_MONTH=YYYY-MM`); freshness audit 2026-06-11 confirmed 2026-05 is the
  latest published month and the roster matches Serebii's index exactly (186 = 186 species pages)
- ✅ **Threat Profile is THE summary** — replaced the role chips and the "Watch for set-up"
  card (their reads are now vectors: Intimidate, weather, screens, set-up). Scan-first redesign:
  colored short headline + one-line detail + a big right-rail number with caption ("99% run it",
  "93% of meta") + colored archetype chips — readable top-to-bottom in about a second

## Wave 3 (go-to-app push: research-driven, in-battle only)
- ✅ **Baked KO benchmarks** — @smogon/calc runs at BUILD time (dev-only dep): every likely move
  of every mon precomputed vs the top-16 meta's common sets. Danger line in the Threat Profile
  ("Play Rough OHKOs Garchomp +1 · 2HKOs 8 of the top meta") + full OHKO/2HKO lists in the move
  sheet. The damage-calculator answer with **zero inputs** — no competitor has this
- ✅ **Battle-compact hero** — artwork demoted to recognition size; the Threat Profile (now with
  likely-set usage bars, top ability/item line, kill-shot strip) + Speed panel fit one screen
- ✅ **Speed panel** — provable Lv. 50 MIN/COMMON/MAX anchors, one-tap Icy/Scarf/TW/Para/TR
  modifiers (TR highlights MIN — slower acts first), full-distribution speed-shape read
- ✅ **Opponent tray + briefing** — pin their team at preview (hero button), persistent bottom
  dock with 4× tags + current-page ring; "Their team" sheet: per-mon archetype + top threat,
  speed order, best types into their team. localStorage only, zero network
- ✅ **Search built for the preview loop** — prefix > type > substring ranking ("gambit" →
  Kingambit, "ghost" → Ghosts), query survives back-navigation (sessionStorage)
- ✅ **Installable PWA + offline** — real 192/512(+maskable) icons, `launch_handler:
  focus-existing` (reopening mid-battle keeps your place), top-3-threat app shortcuts; service
  worker: cache-first statics/sprites, network-first pages → instant + airplane-mode-capable
  after first visit; preconnect to the sprite CDN
- ✅ **Design discipline** — red = threat semantics only (neutral nav chrome), single-hue
  luminance stat ramp (colorblind-safe), 10px type floor, 44px touch targets, numbers win the
  hierarchy (17px right-rail stats)
- ✅ **Freshness automation** — weekly GitHub Action re-bakes all data (auto-latest Smogon
  month) and opens a PR on changes; the home header shows regulation + updated date

## Data refreshes
- ✅ **2026-07-10 → Smogon month 2026-06** (from 2026-05) via `npm run data:all` — 2026-06 is
  the newest published month for this format (2026-07 not out until ~early Aug). Battles
  3.36M → 1.48M. Master+ 247 → 244 profiles, all-ranks 264. **Meta shift:** Kingambit → #1
  (46%, +6pp), Basculegion → #2 (−9pp); big risers Incineroar (+14), Mega Floette (+14),
  Sinistcha (+10), Mega Froslass (↑12 ranks); Aegislash/Pelipper/Sableye fell. Set moves:
  Kingambit Low Kick → Iron Head, Basculegion Choice Scarf → Mystic Water, Talonflame
  Acrobatics → Brave Bird. **PokeAPI drift** (from the roster re-bake `data:all` requires to
  keep both files' generatedAt in sync): 65 previously-null form sprites now populated;
  Meowstic's mega split into male/female (functionally identical — same 566 BST/Trace, differ
  only in sprite). **Fixed:** `generate-dataset.mjs` now collapses forms identical on every
  battle-relevant field (label/kind/types/stats/abilities), keeping the default variety's
  sprite — Meowstic renders a single "Mega" tab; genuinely distinct forms (Mega Charizard X/Y)
  are untouched. Verified via toggle DOM (`Base|Mega` vs Charizard `Base|Mega X|Mega Y`) +
  375px screenshot. All integrity checks + tsc/lint/build (232 pages) green.

## Not available
- ❌ **Checks & Counters** — the Champions doubles ladder dump ships none (empty for all mons)
- ❌ **Tera** — Champions has no Terastallization

## Reviews
- ✅ Multi-lens UX + mid-battle review → top improvements implemented
- ✅ Final adversarial code review (18 agents, 14 findings raised) → **0 confirmed**; clean
- ✅ **2026-07-22 UI/UX polish pass** (4-lens design critique → 37 findings → 3 packages
  shipped). **Color law:** stat bars back on the documented single-amber luminance ramp
  (had regressed to red→green); all view-switch chrome (BracketToggle, form toggles, moves
  filters, calc weather/toggle cells, SP sliders) moved to a neutral white active state —
  red is threat-only again; Trick Room + "Both foes" tags sky→violet (cyan = newcomer only);
  text-input focus rings neutralized (was a double red ring on the autofocused search);
  Mega card halo tamed to a whisper. **Ergonomics:** hero speed chip ("Spe 70 · max 112")
  above the fold; Enter/Go opens the top search result; calc selects + move search → 16px
  (kills iOS focus auto-zoom); `.tap-row` 44px hit-area utility on speed/moves/form/tray
  chips; calc SP sliders restyled (28px grab strip, 18px neutral thumb); save-set button
  confirms with ✓ "saved"; pin button explains "Tray full" on tap; calc field cells got real
  accessible names + HP ▾ cycle cue. **One language:** calc header is a route title with
  un-truncated "Master+ sets" subtitle; calc opens on the top-2 picked mons (baked
  `defaultSlugs`), not Abomasnow/Absol; spreads speak Stat Points everywhere
  (`formatSpreadSp`; detail caption + TeamSetCard "Stat Pts" row + nature effect); team set
  move chips type-dotted (server-built move→type map); home masthead "Reg M-B · updated …"
  (kills the orphaned "226" line + duplicate count); copy sweep ("Sets", "set recreation",
  "→ Attacker/Defender", archetype tag drops the hud-label tick). tsc/lint/77 tests/build
  (247 pages) green + before/after 375px screenshots on all five routes.

- ✅ **Spread-move damage (×0.75) — audit + surfacing.** Owner: "moves like Heat Wave do less damage
  when more than one is on the field — put that in the move popup, and find the exact divider."
  Audited all 493 baked moves against @smogon/calc AND a live Showdown fetch. **Ground truth:** ×0.75
  (3072/4096) on BASE damage, `pokeRound`ed, before weather/crit/STAB/type — and keyed on actually
  hitting 2+ targets, so a spread move into a lone foe deals FULL damage. **Bug found and fixed:**
  `matcha-gotcha` was baked `selected-pokemon` (PokeAPI is wrong) though it really hits both foes —
  the only target mismatch in the whole index, and it sat on Sinistcha (33% usage, 99% of sets), so
  /calc overstated it by a third and the sheet said "Hits one target". `generate-dataset.mjs` now
  reconciles the spread axis from Showdown; the baked JSON was patched in place (1-line diff, no
  re-bake — `competitive.json` benchmarks were already reduced). **UI:** a "Spread damage" panel in
  the move sheet (`80 → ×0.75 → ≈60`, "1 target" vs "2+ targets") with the ally-hitting variant
  spelled out, the KO block tailed "×0.75 already applied", and `MOVE_NOTES` caveats for Dragon Darts
  (hits both foes at FULL power), Expanding Force (becomes spread in Psychic Terrain) and
  Eruption/Water Spout (150 is full-HP only). **/calc:** a `TARGETS · 2 left / 1 left` control in the
  field console driving the new `CalcField.singleTarget` (Heat Wave Charizard→Kingambit 59–71% →
  79–94%). **Guards added** so this can't regress: `damage.test.ts` no longer `continue`s past a
  target disagreement (that skip is exactly how the bug shipped) and now checks all 493 moves, plus
  `npm run audit` cross-checks targets offline — both proven to go red when the bug is reintroduced.
  Dead `move.spreadHit` assignments removed (verified no-ops). tsc/lint/80 tests/audit/build (248
  pages) green + 375px screenshots of both sheet variants, the single-target control case and /calc.

- ✅ **2026-08-08 data refresh (Smogon 2026-07) + the two calc bugs it exposed.** Routine `npm run refresh`
  onto the newly-published month (still Reg M-B, no rotation): 1.16M → **1.76M battles**, 282 Master+
  profiles (276 with KO benchmarks), 301 all-ranks, 14 meta teams. Meta moved a lot — **Kingambit
  24.6→36.8%** (now #1) and **Mega Charizard Y 17.9→30.6%** lead the risers (Venusaur +4.8, Mega Aerodactyl
  +4.6 — sun is up); rain/trick-room slid (Pelipper −5.7, Mega Swampert −6.1, Sinistcha 33.2→26.1%,
  Mega Metagross −6.9). **The re-bake turned `damage.test.ts` red, and it was RIGHT twice over:**
  ① **Body Press** attacked with the user's **Atk** instead of its **Def** (Mega Metagross overstated ~16%);
  ② **Knock Off** never applied its **×1.5 vs a target holding a removable item** (understated ~33%). Both
  had been wrong since the engine shipped and were invisible only because Group A's sample (top-34
  attackers × top-5 moves) had never picked those combos up — the ladder shifting is what surfaced them.
  33 meta mons run Body Press, 43 run Knock Off. Fixed in `damage.ts`, with `isMegaStone` for the one
  un-knockable item (Mega Stone on its own Mega); @smogon/calc can't referee that (Champions invents its
  own stones), so the predicate is pinned against the baked item pool instead. **Guards added:** 5 hand-built
  Group-B pins (Body Press ±Def boost, Knock Off with item / without / vs a Mega Stone) + 2 `isMegaStone`
  tests — all verified to go red when each fix is reverted, so neither can hide behind the sample again.
  **Bug found while verifying:** a `<select>` whose value matches no option renders as the first one, so
  every Mega's Item field in /calc read **"None"** while the mon actually held its stone (one tap discarded
  it) — `itemOptions` now appends any held item the fixed `ITEMS` list lacks. 87 tests (was 80) · tsc ·
  lint · online audit (299 usages cross-checked, 0 mismatched) · build 248 pages · 375px screenshot.

- ✅ **2026-08-08 refresh Action hardening (owner: "run it twice a week; if one's set up it may need
  fixing — last update was 12 days ago").** Forensics first: the Action existed (Mondays 09:00 UTC) and
  had failed **5 of its last 9 scheduled runs, all silently** — Jun 15/22/29 on the missing-Mega-ability
  data hole (since fixed), Jul 6 on the then-missing "allow Actions to create PRs" repo setting (enabled
  ~Jul 11), and Aug 3 on the damage-parity suite catching the real Body Press/Knock Off engine bugs
  (fixed in PR #25) — that last one is exactly why the data sat 12 days stale. Changes: cron → **Mon +
  Thu 09:00 UTC**; the job now runs the literal **`npm run refresh`** (it previously hand-rolled 4 of
  its 5 steps and skipped the offline audit); **found + fixed a latent deploy bug** — `add-paths` shipped
  only the three JSONs while `generate-competitive.mjs` also stamps `public/sw.js`'s cache VERSION from
  the data hash, so every auto-merged refresh deployed a byte-identical service worker (old caches never
  purged, offline fallback stale; verified: merged auto-PR #23 contains no sw.js) — sw.js now rides along;
  **failure alarm**: any failed run files/updates a stable-titled GitHub issue ("Scheduled data refresh is
  failing") with a triage list, so silence is impossible (`issues: write` added); checkout/setup-node
  bumped v4→v7 (verified current; drop-in); stale "232 pages" PR copy fixed. A 4-agent adversarial
  verify pass (22 findings, 10 real) then hardened the hardening: **45-min STEP timeout** so a hung run
  (PokeAPI-backoff → 6h GitHub kill = "cancelled") still fires the `failure()` alarm; **a second alarm
  for the green-but-salvaged teams bake** — on a regulation rotation the generator deliberately exits 0
  and status/audit stay soft, so stale teams would have auto-merged twice a week forever with zero
  signal (both drift branches tested: rotation = format mismatch, blip = generatedAt mismatch) — plus a
  `teams_thread` dispatch input so the KNOWN_THREADS hotfix is runnable from the Actions UI; 3-try
  retry on `gh pr merge` (fresh-PR mergeability is computed async — a transient refusal would have
  filed a false alarm); truthful summary branches for cancelled/"closed" runs (the action leaves the
  operation output EMPTY, not "none"); comment warning that branch protection on main would break
  GITHUB_TOKEN auto-merge unfixably. **Then a LIVE smoke test (workflow_dispatch on the PR branch)
  caught what four adversarial reviewers checking each action in isolation could not:** checkout@v6+
  changed credential persistence, and create-pull-request@v6 adds its own Authorization extraheader —
  git sends both → GitHub 400 "Duplicate header" → the PR step dies. Pairing rule now in the YAML:
  **checkout ≥ v6 requires create-pull-request ≥ v8** (v8 verified: same inputs/outputs for everything
  used). The same failed run also proved the alarm end-to-end — it filed issue #27 in production.
  Verified live: "Actions may create PRs" is ON, main is unprotected. Known
  accepted churn (reported, not changed): generatedAt restamps every bake → scheduled runs always merge
  a dated diff. Brief updated. NOTE: merge PR #25 before the next scheduled run — the parity failure is
  in main's engine until then.
- ✅ **iOS-review round 2 (web side, 2026-11-18): team links, briefing immunities, KO headline, 4× tag.**
  (1) Kimi: "Lycanroc Dusk" (Tough Claws) linked to the Midday-only page — the teams resolver fell back to
  the base species for unmodeled forms. Now exact page/form or `slug: null`; `generate-teams.mjs --relink`
  re-resolves the committed teams.json offline (the forum gate blocks the full bake) — diff = that one
  slug; status + audit fail a linked member whose label/ability/types aren't the destination's (proven
  red on the old file). (2) Astra #15: briefing "Ground hits 2 of 2" into Levitate-only Heat Rotom + Mega
  Chimecho — `briefingBestTypes` scores per possible ability (guaranteed immunity/resist never counts;
  a possible immunity is counted + "⚠ X may be immune"); pins carry `abilities`; Eelevate added to the
  ability tables. (3) Fable #7: the KO line under "Likely set" headlined unshown moves (36/277, e.g. Mega
  Charizard Y's 8% Hurricane) — `headlineBenchmark` picks among the six shown; 4 profiles still fall back.
  (4) Fable #12: briefing 4× tag names its type ("4× Ground", legible ink). Tray chip tag not changed.

- ✅ **iOS-review round 2 (web side, 2026-11-18): calc verdicts.** Four reviewers (Astra, Sol, Fable, Kimi)
  found the calc's verdicts wrong in ways the TS shared with iOS; all fixed with reviewer-number tests
  (`calc-data.test.ts`, `damage.test.ts`; 484 tests): battle identity per form (`battleName` — Kantonian
  Tauros fought as the borrowed Paldea-Aqua set, Castform's Forecast never fired); Focus Sash / Sturdy /
  Disguise / Ice Face at full HP (`survival`, `hpAfter`); multi-hit KO odds from independent rolls (Twin
  Beam 50% → 30.47%); 3-use look-ahead (Draco Meteor's "guaranteed 2HKO" that the −2 SpA makes
  impossible); Dragon Darts one per foe with two targets; Gale Wings priority vs Armor Tail; Aegislash
  attacks in Blade (`attacksAs`); per-side target counts; resolved move facts on the result (Weather Ball
  in sun = Fire 100); effective-speed turn order (+ Speed boost, Paralysis, Tailwind, Trick Room
  controls); Mega stones as `requiredItem`; presets keep fixed-damage moves (Final Gambit, Night Shade);
  calc links carry the form (`af` / `df`). Also: links to a BASE form always pass `?form=<slug>` (tray,
  briefing, partner chips, team cards) — the detail page opens on the ladder default otherwise, i.e. the
  Mega for Meganium; "no live calls" copy → "no live data calls" (images do load from GitHub).
- ✅ 2026-11-18 Maushold follows the game data (see the Maushold entry above).
- ✅ **iOS final review (web side, 2026-11-18): one use for a move that faints its user; honest KO odds.**
  The 3-use look-ahead also walked Explosion, Self-Destruct, Misty Explosion and Final Gambit (the only
  damaging user-fainting moves in the index — Memento / Healing Wish are status), so Final Gambit
  (Staraptor into Rillaboom, 192 into 207) read "93–93% · 2HKO" and Explosion (Metagross into Kingambit,
  66–79 into 207) "3HKO–4+ HKO" — uses the user never lives to make. `damage.ts` walks ONE use for them
  (`MoveFacts.userFaints`; `uses[1..2]` zero, `koChances` all equal): "OHKO", a partial "OHKO · 31%"
  (Explosion into Garchomp), or "No KO"; the facts line adds "user faints". KO chances print through
  `formatKoChance` (format.ts): a real chance is never "0%" / "100%" — "<1%" (Population Bomb into
  Appletun, 0.0004%, read "0% OHKO") / ">99%". Tests: `calc-data.test.ts` (the reviewers' cases),
  `format.test.ts`; 504 tests, tsc, lint green. Not done, noted: the BAKED benchmarks (@smogon/calc)
  still count Explosion "2HKOs" (Metagross, Mega Glalie) on the Threat card / move sheet — a bake-side fix.
## Optional / not done
- ⏳ Download HOME sprites locally for fully offline images (data is already local; deferred as
  repo bloat vs the ~80ms prod nav already in place)

## Project docs
- ✅ README.md · ✅ this checklist
