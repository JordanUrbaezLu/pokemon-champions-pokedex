<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Champions Pokédex — project brief (read me first)

**Mission:** the go-to helper for Pokémon Champions (doubles, Switch 2 + mobile). The core is
IN-BATTLE — a trainer has 1–2 minutes per decision, so scouting/threat features are judged by
**seconds-to-answer**. Two deliberate prep-side tools now live alongside it as their own routes
(NOT bolted onto the battle flow): **Meta Teams** (`/teams`) and the **Battle Calc** (`/calc`, a
full damage calculator — pick any two mons, edit their sets, see who KOs whom). These are focused
tool modes: they may cost more taps than the seconds-to-answer scouting screens, and that's fine.
(Historical note: the brief once said "team builders are out of scope" — that was reversed on
purpose when Teams + Calc shipped.)

**Parallel agents are normal (up to ~3 at once: T3 Code threads, Claude/Codex/Kimi sessions)**
- One task = one worktree + branch: `git worktree add -b agent/<task> ../pcp-wt-<task> origin/main`, then
  `ln -s ../pokemon-champions-pokedex/node_modules node_modules` (or `npm ci`). With a symlinked
  `node_modules`, Turbopack refuses to run — use `npx next build --webpack` / `next dev --webpack`.
- Never develop in the main checkout `~/Repositories/pokemon-champions-pokedex`: the iOS app
  (JordanUrbaezLu/champions-vgc-dex) exports its bundled data and golden fixtures FROM it (`$CDX_WEB`), and
  its release gate refuses a dirty or stale checkout. Keep it clean and on `origin/main` (`git pull --ff-only`).
- Commit only your own paths (`git add <paths>`, never `-A` blindly); land work through a PR (CI + preview).
- The data generators (`npm run data`, `data:comp`, `data:teams`) hit the network and rewrite
  `src/data/generated` — one at a time, in your own worktree. Dev servers: pick a free port (`-p`).
- Full protocol (iOS side, with simulator locks): champions-vgc-dex `docs/parallel-agents.md`.

**Hard constraints**
- Mobile-only (375px first), dark theme, fully static: every page prerendered, **zero runtime
  API calls** (only the sprite CDN, which the service worker caches). Client JS stays small.
- Data is baked at build into `src/data/generated/{pokemon,competitive,teams}.json` (committed).
  `roster.json` is the source of truth: `roster` = every species (PokeAPI slugs), `newcomers` =
  recently-added species the generator stamps `isNew` on (drives the NEW badge + home filter) — prune a
  slug once it has a ladder profile of its OWN (rule + history in its `newcomersNote`; status ⚠ lists them).
- Champions rules: doubles, Lv 50, fixed 31 IVs, Mega Evolution, **no Terastallization**.
- The in-game top rank is **Master** — the top-bracket data set is called **Master+** in UI
  and `master` in code/data. Never "Champion rank" (Champions is the *game's* name).

**Map**
- `src/app/page.tsx` home (search list) · `src/app/pokemon/[name]/` detail (server page +
  `PokemonDetail.tsx` client) · `src/app/teams/` Meta Teams (list `page.tsx` + `[slug]/` detail, both
  server/static; `MetaTeamCard`/`TeamFormation`/`TeamSetCard` components) · `src/app/calc/` Battle Calc
  (static `page.tsx` builds a compact index server-side → `Calc.tsx` client builder) · `src/app/layout.tsx`
  mounts OpponentTray + SW registrar. Home header links to both `/calc` and `/teams`.
- `src/lib/`: `pokedex.ts` (all data access; bracket-aware), `threat.ts` (Threat Profile
  engine), `battle.ts` (Lv50 math, speed anchors/mods, trap abilities), `type-chart.ts`
  (type math + ability-aware `effectiveDefensiveProfile` for the kill-shot),
  `type-meta.ts` (type colors/labels/order shared by badges, cards, tray),
  `bracket.ts` + `opponents.ts` (localStorage stores), `format.ts` (names, labels — incl. the Calc's
  form pills), `move-facts.ts` (the move sheet's fact chips), `types.ts`.
  Calc engine: `damage.ts` (client-side gen9 damage formula), `spread.ts` (shared spread-move
  predicate), `stat-points.ts` (Champions Stat Points ↔ EVs), `calc-data.ts` (the `/calc` index).
  UI sheets (move/item/briefing) share `src/components/Sheet.tsx` — see hard-won facts.
- `scripts/`: `generate-dataset.mjs` (roster/movepools/moves), `showdown-data.mjs` (the pinned
  Showdown commit + AST parser + Champions learnset/PP rules), `generate-competitive.mjs`
  (both ladder brackets + baked KO benchmarks via @smogon/calc), `generate-teams.mjs` (real meta teams
  from Smogon's sample-teams thread → `teams.json`), `species-aliases.mjs` (Showdown ↔ roster form
  names + unmodeled forms, shared by all three), `status.mjs`, `screenshot.mjs`.
- `CHECKLIST.md` = living log of everything requested/built. `README.md` = user-facing.

**Commands**
- `npm run dev` / `npm run build && npm run start` (prod).
- `npm run data` / `npm run data:comp` / `npm run data:teams` / `npm run data:all` — re-bake data.
  `SHOWDOWN_SHA=<sha> npm run data` trial-bakes another Showdown commit (status stays red until
  `PINNED_SHOWDOWN_SHA` in `scripts/showdown-data.mjs` matches — that one line IS the bump).
  `data:all` runs all three in order (teams last — it reads the fresh competitive.json for usage +
  form resolution). The competitive
  script **auto-detects both the current ladder REGULATION and the newest published Smogon
  month** — it reads each month's chaos index newest-first and takes the highest-lettered
  `gen9championsvgc2026regm*` (…regmb > …regma), so a game regulation rotation needs no code edit.
  Pin either: `STATS_FORMAT=gen9championsvgc2026regmb` / `STATS_MONTH=YYYY-MM`. (Game + ladder are on
  **Reg M-C** — v1.2.0, 2026-09-09; Smogon's 2026-09 stats were the first M-C month, auto-detected.)
- **`npm run refresh` — the one-command manual data update (use THIS, not `data:comp`):**
  `data:all → status → test → build`. It re-bakes both files (keeping `generatedAt` in sync —
  `data:comp` alone fails the status date check), runs every integrity check + the unit suite +
  the build, and stops on the first failure. Green = the two `src/data/generated/*.json` are ready
  to commit. Nothing else to remember.
- `npm run status` — one-command context: data freshness, bracket coverage, integrity checks.
- `npm run audit` — deep data-CORRECTNESS audit (`scripts/audit-data.mjs`): cross-checks every
  Pokémon/form's baked usage/EVs/move %/ability %/items/teammates/benchmarks against internal
  invariants AND the live Smogon source. `npm run audit -- --offline` skips the network checks
  (this offline pass is wired into `refresh`). status proves nothing is BLANK; audit proves
  nothing is WRONG. Exits non-zero on any HIGH finding.
- `npm test` — Vitest unit suite for the pure logic (type-chart, Lv50 math, threat engine,
  formatters). Node-only, no build. This is the regression net for the weekly data re-bake.

**Keeping data current (the whole loop, for the next agent)**
1. `npm run status` — is it fresh + are the integrity invariants intact? (freshness = the date +
   the coverage floors; if `⚠ data is N days old` or a newer regulation exists, re-bake.)
2. `npm run refresh` — the update button: re-bakes both files from the newest published month +
   regulation (auto-detected), then status → offline audit → tests → build. Green = ready to commit.
3. `npm run audit` — the correctness net (run the online form for the freshness + usage cross-check).
   New failure modes get a check ADDED here so they can never regress silently.
That's the entire contract. The twice-weekly Action runs `refresh` and opens/auto-merges the data PR.
- `npm run shot -- /pokemon/kingambit out.png` — 375px screenshot of a running app
  (`PORT=3210` env to target another port). Use it after every visual change. `TAP="Frost Breath"`
  taps a button first, so a sheet is shot OPEN; `|` chains taps (`TAP="Show all|Dragon Cheer"`).
- A twice-weekly GitHub Action (`.github/workflows/refresh-data.yml`, **Mon + Thu 09:00 UTC**) runs
  the same `npm run refresh`, opens a PR with the data diff **+ `public/sw.js`** (its cache VERSION is
  stamped from the data — omit it and deployed service workers never purge old caches; the pre-2026-08
  auto-PRs had that bug), and **auto-merges when green** (manual run: Actions tab → Run workflow,
  optional `stats_month` / `teams_thread` inputs to pin). **"Never silent": on ANY failure it
  files/updates the issue "Scheduled data refresh is failing"** (added after five 2026 runs failed with
  nobody noticing; a red parity test there is usually a REAL signal — fresh data exercising an engine
  gap, per the Body Press/Knock Off incident); a **45-min step timeout** turns a hung run into that
  same alarm (a cancelled run never satisfies `failure()`); and a **green-but-salvaged teams bake**
  (regulation rotation) files its own issue — refresh deliberately stays green on salvage, so without
  that check stale teams would auto-merge twice a week forever. **`create-pull-request` restores the
  working tree to the pre-run checkout**, so a step after it reads the PREVIOUS run's data — the salvage
  alarm sat there and filed every alarm one run late (the run that really salvaged filed nothing); it
  now reads the stamps in a step BEFORE the PR. Smogon's forum 403s the runners in bursts, so the
  thread fetch retries ~2.5 min before salvaging. **One-time repo setting required:**
  Settings → Actions → General → Workflow permissions → enable *"Allow GitHub Actions to create and
  approve pull requests"* — without it the PR step fails with *"not permitted to create pull requests"*
  (killed the 2026-07-06 run). **Never add branch protection/required checks to main** without moving
  this workflow off `GITHUB_TOKEN` (its PRs can't trigger required checks or self-approve). Known
  accepted churn: `generatedAt` restamps every bake, so scheduled runs always merge a dated diff.

**Hard-won facts — do not re-learn these**
- Smogon chaos `Checks and Counters` is **empty for every mon** in this format. Never plan on it.
- **Meta Teams are REAL teams, never synthesized.** Smogon exposes no teams for this format (only per-mon
  co-usage), so `generate-teams.mjs` scrapes Smogon's official **"Champions VGC Regulation … Sample Teams"**
  forum thread + the linked PokéPastes. The thread's link ordering is off-by-one vs its team titles, so
  join paste↔title **by species set**, not position. A paste lists a Mega's **pre-Mega base ability**
  (Showdown convention) — override it with the Mega form's real ability for display. The thread id is
  **per-regulation and NOT derivable** from the stats format id, so `KNOWN_THREADS` maps each format →
  thread URL: **on a regulation rotation, add one line there** (or pin `TEAMS_THREAD=<url>`). Until then the
  generator warns + salvages the committed teams.json (so a rotation flags "teams a reg behind" without
  hard-failing refresh). EV spreads use Champions' own small scale — bake them verbatim, don't renormalize.
- **Smogon's forum gates plain fetches (seen 2026-11-17): HTTP 200 + a JavaScript proof-of-work page**
  ("Checking your browser…", `forum_gate` cookie) — not the 403 bursts — for EVERY thread, the long-working
  M-B one too, so `data:teams` can't read sample teams at all (PokéPaste is not gated). The generator spots
  it by content and salvages with that reason (it used to say "layout changed?"). Reg M-C's thread DOES exist
  (`…regulation-m-c-sample-teams.3790579`, posted 2026-10-29; its title gained a "Pokémon" prefix, so the slug
  is NOT M-B's with the letter swapped) and is in `KNOWN_THREADS` — so the CI alarm's "add the line" advice
  is stale for M-C: the blocker is the gate. Never script the proof-of-work; a way past it needs a human call.
- **A team member links ONLY to an exact page/form (2026-11-18).** The resolver used to fall back to the base
  species for any unmodeled form, so Reg M-B's "Lycanroc Dusk" (Tough Claws) opened the Midday-only page and
  every check stayed green (the audit even skipped it as "can't be judged"). Now: exact page → exact form →
  else `slug: null` (no link; quiet for `UNMODELED_SHOWDOWN_FORMS`, a loud warning otherwise — the same mon
  spelled differently belongs in `SHOWDOWN_TO_ROSTER`). status FAILS a linked member whose label, ability or
  types aren't its destination's. With the forum gated, apply a resolver fix offline:
  **`node scripts/generate-teams.mjs --relink`** rewrites only slug/formKey/formLabel of the committed file.
- **Briefing "Best types" is ability-aware (`battle.ts` `briefingBestTypes`)** — raw type math said "Ground hits
  2 of 2" into Levitate-only Rotoms. Counted iff ≥2× under at least one of the form's possible abilities; flagged
  "may be immune" iff some (not all) make it 0×. Pins carry `abilities` (old pins → raw math). Eelevate is a Ground
  immunity in `type-chart.ts` too. **The Threat card's KO line picks only among the "Likely set" moves it shows**
  (`threat.ts` `headlineBenchmark`; benchmarks cover the top six DAMAGING moves, which reach past the six shown).
- Chaos cutoffs: 0 / 1500 / 1630 / 1760. High-cutoff files **weight** Moves/Teammates/Spreads
  tables but NOT `Raw count` — per-set rates must divide by the weighted set count (the
  Abilities-table sum), or every % silently becomes 0 at 1760.
- Brackets: `master` = 1760 backfilled per-mon from 1630 only; `all` = whole ladder. Both are
  fully baked; the toggle (home only, default Master+) switches client-side. KO benchmarks are
  baked for the `master` bracket only.
- **Game data = Pokémon Showdown's `champions` mod (MIT), never Serebii** (switched 2026-11-18 for
  App Store 5.2.2: Serebii's pages are "© Serebii.net" with no reuse licence — never re-add a Serebii
  fetch). Read at ONE pinned commit (`PINNED_SHOWDOWN_SHA`), recorded in `pokemon.json` →
  `sources.showdown.commit`. The `.ts` data files hold battle callbacks too: they are AST-parsed for
  literals, **never executed**. Rules the mod keeps in code (PP cap/scale in `scripts.ts`; no prevo
  inheritance in `sim/dex-species.ts`) are mirrored by hand and **tripwired** verbatim — a bump that
  changes one fails the bake.
- **Movepools = the mod's per-form learnsets, nothing else.** They are standalone (one complete list
  per legal species/form) and Showdown's own lookup never walks prevos for this mod, so the old
  PokeAPI ∪ Showdown ∪ prevo union is GONE — it was the leak: Serebii species pages are multi-form
  unions, and the union let 59 sibling-form moves through (Indeedee-F had 12 of Indeedee-M's incl.
  Expanding Force, Midday Lycanroc 19 of Midnight/Dusk's). Megas share their base's. A roster slug
  must resolve to a Champions-LEGAL Showdown species or the bake ABORTS — there is no mainline
  fallback anymore. PokeAPI's `floette` is the mainline Red-Flower form; Champions' is
  Floette-Eternal — for the learnset (`ROSTER_TO_SHOWDOWN_SPECIES`) AND the stats/sprites
  (`ROSTER_TO_POKEAPI_POKEMON` → `floette-eternal`; the page shipped Red-Flower 54/…/52 stats until
  2026-11-18). The bake cross-checks every page/form's PokeAPI stats + types against Showdown's species
  (`sources.rosterCheck.statMismatches`, status fails on any). Meowstic is one page for both genders →
  `POOLED_MOVEPOOLS` unions the female's (as `EXTRA_BASE_ABILITIES` does Competitive). Tera moves are
  excluded everywhere. `MOVEPOOL_OVERRIDES` (documented, per-entry reason) is the only escape hatch —
  empty: all 61 Serebii-vs-Showdown differences went Showdown's way (CHECKLIST 2026-11-18).
- **The ladder can't prove a learnset wrong** — Smogon's stats are Showdown battles, validated by these
  same learnsets. Independent cross-checks: real in-game tournament teams (`teams.json`; the audit's
  LOW "outside the baked movepool") and PokeAPI's `champions` version group (logged each bake; 193 of
  the 226 mons it covers match exactly; of the other 33, 30 are PokeAPI lagging v1.2.0 — Slash ×29,
  Politoed Pound, Archaludon Metal Burst/Mirror Coat — Meowstic is the pooled female's two moves, and
  PokeAPI lacks Mawile's Charm/Draining Kiss/Misty Terrain and Houndstone's Bulldoze, which Showdown AND
  the old Serebii tables both have and the ladder uses (0.4–2.1%, all ranks): unresolved, not lag. It sided with
  Showdown on all 46 of the 61 Serebii differences it covers).
- PokeAPI sometimes 502s persistently on single endpoints; the generator salvages those entries
  from the committed dataset and logs it. Patient exponential backoff is already in place.
- **Names are OFFICIAL — Showdown's `name`, never the slug rule (2026-11-18).** `toDisplayName` (split
  on "-", capitalise) can't rebuild punctuation, and both generators used it as a NAME: "U Turn", "Will O
  Wisp", "Kings Shield", "Kings Rock", "Never Melt Ice", "Good As Gold", "Kommo O", "Mr Rime", "Farfetchd"
  (23 names). `officialName` (generate-dataset) and generate-competitive's item/move lookups (it loads the
  dex at `sources.showdown.commit`) take Showdown first, then PokeAPI's English `names`, the slug rule
  last (logged "name(s) not from Showdown"). Every consumer that MATCHES names goes through `stripId` /
  the library's `toID` / `canonicalItem`, so no number moved; SEARCH must be punctuation-blind
  (`searchKey` in format.ts — a raw `toLowerCase().startsWith` lost "u turn", "mr rime"). Showdown spells
  species with ’ (Farfetch’d) but moves/items with ' (King's Rock) — keep both. `names.test.ts` holds
  every name to @smogon/calc's tables. Partner chips carry `formKey` (→ `?form=`): a "Mega Charizard Y"
  chip opened base Charizard, and "Tauros-Paldea-Aqua" opened Kantonian Tauros (no `-breed` step).
- **The roster is checked against Showdown's champions formats-data on every bake** (`sources.rosterCheck`;
  status fails on a gap) — this replaced hand re-diffing a roster web page. Deliberately unmodeled legal
  forms (Lycanroc Midnight/Dusk, Tauros Combat/Blaze, Gourgeist sizes, Castform weather) are listed with
  a reason in `UNMODELED_SHOWDOWN_FORMS`. The Serebii era's silent 404 → mainline-movepool fallback (it
  bit 11 of 29 Reg M-C newcomers) is impossible now, but its canaries stay in status: v1.2.0's removals
  (Politoed/Pound, Archaludon/Mirror Coat + Metal Burst) return the moment a movepool isn't the pinned
  Champions learnset.
- **Showdown names some forms differently from the roster — also SILENT.** `Indeedee-F`/`Indeedee` ↔
  `indeedee-female`/`-male`, `Meowstic-F-Mega` ↔ the one collapsed `meowstic-male-mega`, `Basculegion-F`.
  Miss one and the page ships with NO ladder data + dead teammate links: Indeedee-F (#7, 20% of Reg M-C)
  did exactly that on the first M-C bake. `scripts/species-aliases.mjs` is the single table (competitive
  bake + teams minisprites + the dataset's learnset lookup). A rename is the SAME mon — never `asForm` (that blanks its move/ability
  usage and drops it from KO benchmarks). But Smogon **pools** some forms under the bare name (no
  `Toxtricity-Low-Key` / `Squawkabilly-Blue` keys exist — "Toxtricity" carries Low Key's Minus), so those
  are `STATS_POOLED`: borrowed as `asForm` "X (all forms)" — the audit's ability check caught that.
  Unclaimed ladder species land in `competitive.meta.unmatched`; status FAILS on any ≥2% (Lycanroc-Dusk
  ~1% is the known unmodeled form — roster has only base Lycanroc).
- **Which layer owns a balance patch.** MOVEPOOLS: the champions learnsets — legality changes need NO
  code, a bake at a bumped SHA picks them up (v1.2.0's Pound removal, Slash 0 → 36 movepools). Move
  STATS: PokeAPI's **mainline** values, then the mod's `moves.ts` patches win field by field
  (`applyChampionsMove`: Grav Apple 90, Meteor Assault 170, Make It Rain 95% / −2 SpA, Iron Head 20%
  flinch, Freeze-Dry can't freeze, Snap Trap Steel, Dragon/Shadow/Crush/Dire Claw slice, Double Shock
  punches…), plus Champions' own **PP scale for every move**: base PP capped at 20, in-battle
  `(pp/5+1)×4` → 8/12/16/20 (mainline-10 Wish read 12 pre-v1.2.0 and 8 after: the mod's pp 10 → 5;
  no-PP-Ups Revival Blessing stays 1). Showdown's prose replaces PokeAPI's only where the mechanic
  changed (Champions-specific text, a patched mechanic, or a move the mod reinstates from "Past" —
  PokeAPI still says King's Shield drops Attack by 2). `LOCAL_MOVE_OVERRIDES` (evidence per entry) is
  only for Showdown lag — one entry: Milk Drink's TEXT (the mod retargets it to an ally; Showdown's text
  has no champions entry and still says "heals the user"); its `staleText` fails the bake once that changes. @smogon/calc carries MAINLINE moves, so the KO benchmarks AND
  `damage.test.ts` feed it the baked power/type/category/flags (`championsMoveOverrides`, two copies
  kept in step) — without that First Impression (Mega Golisopod, 76%) silently left the parity sweep.
- **Z Mega Evolution is real** (v1.2.0 / Reg M-C, 2026-09-09) — `-mega-z` used to be filtered out of
  `BATTLE_FORM_RE` as an API-only junk variant, and that comment is now the opposite of true. Mega
  Lucario Z (**Aura Guard**, a Champions-original ability PokeAPI does carry, with effect text), Mega
  Garchomp Z (Levitate) and Mega Absol Z (Sharpness) are real battle forms, and a species can now hold
  **both** a plain Mega and a Mega Z — so nothing may assume one Mega per species or an X/Y-only
  suffix. `pokedex.ts`'s list-card summary still shows only the first Mega (fine, it's a thumbnail);
  the detail page maps over every form, so the tabs work. status asserts both forms survive. Two display
  helpers DID assume X/Y until 2026-11-18: `prettySmogonName` printed "Garchomp-Mega-Z" raw in partner
  chips / KO lists, and the Calc's pills read "Mega" twice for Lucario — both read any letter now
  (`format.ts`; a data-driven test holds every ladder name to the page/form's own label).
- PokeAPI once served 11 Champions-original Megas with `abilities: []`; it serves all of them now
  (incl. **Eelevate**, **Fire Mane**; checked 2026-11-18), so the Serebii-curated `MEGA_FORM_ABILITIES` is gone. The
  net is now Showdown's species data (slots 0/1/H — never "S": Greninja's Battle Bond is illegal here).
  Ability TEXT: Showdown's where it describes Champions — Champions-original abilities (Aura Guard,
  Dragonize, Eelevate, Fire Mane, Mega Sol, Piercing Drill, Spicy Spray) and Champions-changed ones
  (**Healer 50%**, **Unseen Fist ¼ damage**); else PokeAPI's. Run Away blocks trapping in Champions
  (mod code, #12303) but neither source's text says so → `LOCAL_ABILITY_TEXT`. `npm run status`
  asserts every battle form ships an ability+effect.
- Puppeteer's `setOfflineMode` does NOT apply to service workers — to test offline for real,
  prime the cache, kill the server, then navigate.
- **A git worktree whose `node_modules` is a symlink into another checkout can't `next build`**: Turbopack
  panics "Symlink [project]/node_modules is invalid, it points out of the filesystem root". Locally, build
  with a temporary `turbopack: { root: <common parent dir> }` in `next.config.ts` (the bundled `turbopack.md`'s
  fix for linked deps) and restore the file — never commit it; CI's real `npm ci` doesn't need it.
- The Tailwind v4 CSS pipeline **silently drops** a `globals.css` rule whose value is
  `color-mix(..., var(--token) N%, transparent)` — the rule vanishes from the built CSS with
  no warning (bit us on the input focus-ring override). Use a plain rgba() literal instead
  and verify via `document.styleSheets` when a custom rule mysteriously doesn't apply.
- Bottom sheets go through `Sheet.tsx`: it **portals to `document.body`** (a `position: fixed`
  sheet rendered inline is positioned by its ancestors — that's why the deep-in-the-moves-list
  MoveModal silently failed to appear in the installed PWA while the shallow ItemModal only
  covered the footer). It rests ABOVE the opponent tray via `--tray-height` (published by
  `OpponentTray`), so the footer is ALWAYS visible. **Never scroll-lock with `overflow:hidden`** —
  it kills the tray's `position: sticky` and drops the footer off-screen; background scroll is
  contained by the scrim (`touch-none`) + panel (`overscroll-contain`) instead. Any new sheet
  must use `Sheet`, not its own fixed overlay.
- Damage math foundation: `battle.ts` has the lv50 **stat** formula (31 IVs) + speed math only —
  **no damage formula**. Build-time KO verdicts use @smogon/calc (dev-only dep, never shipped).
  Showdown chaos species names are calc-compatible.
- **Battle Calc engine (`src/lib/damage.ts`)** is a hand-port of @smogon/calc's gen789 formula
  (the "Initial" input rewrites, base damage, bp/at/df/final mod chains, `pokeRound`, 16-roll, the
  per-hit loop of multi-hit / Parental Bond), scoped to this format's mechanics — so an interactive calc
  ships with **zero** @smogon/calc in the client bundle. `damage.test.ts` keeps it honest: BOTH the real
  library AND `damage.ts` on the same inputs, 16-roll arrays equal **exactly** — Group A (abilities
  neutralized, core formula), Group C (8.5k real Master+ sets, abilities + items ON, every defender
  ability), ~290 Group B pins, whole-index table tests, one pin per damage item, and "baked benchmarks =
  engine". If the port drifts, CI goes red — treat that test as the spec. It stays EV-model (via `lv50Stats`), so calc numbers equal the
  app's baked benchmarks + Speed reads. Special cases already handled: Psyshock/Psystrike/Secret Sword
  (hit Def), Foul Play (defender's Atk), Freeze-Dry (2× Water), Acrobatics (×2 no item), always-crit moves
  (`ALWAYS_CRIT_MOVES` — Frost Breath/Flower Trick/Storm Throw; Battle/Shell Armor cancel), and the
  variable-BP moves Grass Knot/Low Kick (target weight), Heavy Slam/Heat Crash (weight ratio), Gyro
  Ball/Electro Ball (speed) — see `VARIABLE_MOVES`. Truly situational ones (Counter, Fissure, Fling,
  Endeavor…) stay "not calculated". Saved calc sets live in `calc-sets.ts` (localStorage, like the tray).
- **The doubles spread reduction (`spread.ts`).** Exactly **×0.75 = 3072/4096**, applied to BASE DAMAGE
  after the "+2" and BEFORE weather/crit/STAB/type/final mods, `pokeRound`ed. It is NOT a base-power cut —
  so "power × 0.75" is a display approximation that always reads slightly HIGH (the sheet marks it "≈").
  Showdown's `champions` mod overrides `modifyDamage` but leaves the spread block byte-identical, so the
  game does not change it. **The rule is target-COUNT based, not move based:** it applies only when the move
  actually hits 2+ targets, so a spread move into a lone remaining foe deals FULL damage — each side's
  occupancy is `CalcField.attackerSide` / `defenderSide` (1 or 2; the Calc's per-side "Mons on side"
  control, and each direction reads the TARGET side's count — `targetsHit`), while `singleTarget: true`
  overrides both to one target (it gates ONLY the spread line; never model it by flipping `gameType` to Singles,
  which also swaps the screen modifier 2732→2048). Protect/Wide Guard/immunities do NOT give the cut back;
  only an empty slot does. For `all-other-pokemon` your own ally counts as a target. **Dragon Darts** is the
  only damaging move that hits both foes at full power; **Expanding Force** is the reverse gotcha (becomes
  spread in Psychic Terrain — modelled since the terrain port; both carry a note in `MoveModal.MOVE_NOTES`).
- **PokeAPI move targets are not trustworthy for spread.** It served Matcha Gotcha (Sinistcha's 99%-usage
  signature move) as single-target, so the app skipped the ×0.75 and overstated it 33%. `generate-dataset.mjs`
  now lets Showdown win **on the spread axis only** (`reconciledSpreadTarget`) — deliberately narrow, because
  the two sources also disagree on 9 status moves where PokeAPI's slug is the better UI label. `npm run audit`
  cross-checks all 493 targets against @smogon/calc offline, and `damage.test.ts` asserts it too. Gotcha:
  **@smogon/calc OMITS `target` when it is the default "normal"** — a missing field means not-spread, not
  unknown; treating it as unknown silently skips 455 of 493 moves.
- `move.spreadHit` is **not a thing** in @smogon/calc — it derives the reduction from its own move target +
  `field.gameType`. Setting it was a verified no-op (identical 16-roll arrays); both call sites are gone.
  Consequence: the baked KO benchmarks in `competitive.json` were ALWAYS already ×0.75-reduced for spread
  moves (verified 208/208 rows), which is what the move sheet labels "×0.75 already applied".
- **`damage.test.ts`'s meta sweep only covers the moves the CURRENT month happens to sample.** Group A
  walks the top-34 attackers × their top-5 moves, so a move nobody in that slice runs is UNTESTED, not
  correct. Two were silently wrong until the 2026-07 re-bake moved the ladder: **Body Press** (attacks with
  the user's **Def**, not Atk — was overstating Mega Metagross ~16%) and **Knock Off** (**×1.5 BP** when the
  target holds a removable item — was understating it ~33%; 33 and 43 meta mons run them). Both are now
  hand-pinned in Group B so the sample's luck can't hide them again. **When a re-bake turns the parity test
  red, suspect a real port gap before suspecting the data.**
- **Crits were dead code until the 2026-10 re-bake (issue #55).** `damage.ts` crit only on
  `field.isCritical`, which no UI control sets — so the calc NEVER crit, and Mega Froslass's Frost Breath
  (newly a top-34 attacker) read ≈⅔ of the library's rolls (0.64–0.69), 8 red cases: into Rillaboom a "70–84% 2HKO"
  that is really a 105–126% guaranteed OHKO. @smogon/calc crits from the move's `willCrit` →
  `ALWAYS_CRIT_MOVES` (Frost Breath, Flower Trick, Storm Throw in this index), keyed by NAME because PokeAPI's
  `critRate` serves Flower Trick as **0**. Going live exposed three first-port crit bugs: Choice Band/Specs
  gated `!crit` (the library keeps them), negative attack stages kept on a crit, Battle/Shell Armor not
  cancelling it (+ Sniper, Merciless ported). 20 Group B pins + a whole-index `willCrit` test, mutation-checked.
  (Mold Breaker / Scrappy were the gap noted here — ported 2026-11-18, below.)
- **Group A neutralizes abilities, so it was BLIND to every unported ability (2026-11-18).** Group C runs
  the real sets instead: the pre-port engine failed **891 of 8515** cases — Pixilate/Aerilate Hyper Voice
  read Normal (a Ghost walled Sylveon, Mega Gardevoir, Mega Salamence), Fairy Aura, Armor Tail vs Fake
  Out, Liquid Voice, Mega Launcher, Electro Shot's charge +1 SpA, Miracle Seed / Never-Melt Ice / Charcoal,
  Chople Berry. Now 0. **The library matches ability/item names EXACTLY** — the ladder's "Never Melt
  Ice"/"Kings Rock" and PokeAPI's "Good As Gold" are silently ignored if passed raw (`libAbilityName` /
  `libItemName`; the sweep fails if any ability is unknown and unproxied). **Champions-original
  abilities** (unknown to the library) are oracle'd by the library ability Showdown's mod codes
  identically: Fire Mane = activated Flash Fire, Eelevate = Levitate (isGrounded + breakable), Aura Guard =
  Fluffy's contact half (Multiscale for Fire contact), Mega Sol = Sun for its own moves (Weather Ball Fire
  100, Solar Beam never halved — even through Cloud Nine — and NO Sand SpD / Snow Def boost for the target:
  Showdown's `effectiveWeather()` reads Sun for every Pokémon while it moves), Dragonize = Pixilate→Dragon;
  Piercing Drill changes no roll (Protect isn't modelled). **Spicy Spray burns the user after EVERY hit**
  (onDamagingHit), so a multi-hit / Parental Bond user's later hits land burned — halved if physical
  (oracle: `spicySprayExpected`, the library's per-hit rolls burned from hit 2). `championsProxy` — two
  copies, test + generator; the GENERATOR's Spicy Spray proxy still ignores the burn, exact only while no
  top-16 target runs it (Scovillain-Mega is #58) — "baked = engine" goes red the month that changes.
- **Deliberately unmodelled (no calc input; the library defaults them off too):** Supreme Overlord / Last
  Respects (fainted allies), Rivalry (genders — tests build the library genderless, else it reads +25%),
  Flash Fire's boost, Stakeout, Plus/Minus, Unburden, Intimidate & Defiant/Competitive (boost controls),
  Lash Out, the Metronome item, Protect (so no ¼-through-Protect), crit STAGES (Scope Lens/Leek/Super Luck).
  Library quirks are mirrored, not fixed: Poltergeist fails into a Klutz holder, Klutz Acrobatics doubles,
  a Parental Bond child into Mummy loses its ¼, and an Iron Ball Flying type takes Ground at exactly 1×.
  **Deliberately NOT mirrored** (game-correct, engine-only pins): Gale Wings gives a full-HP user's Flying
  move +1 BEFORE the priority blockers (Talonflame's Brave Bird fails into Armor Tail Farigiraf; the baked
  KO benchmarks still come from the library, so their test carries a narrow, capped exception list);
  Dragon Darts fires ONE dart into the selected foe when the target side has two (2 when alone); KO odds
  come from INDEPENDENT per-hit rolls (exact convolution — the library pairs roll i with roll i) and the
  verdict looks ahead 3 uses (self drops, spent one-time items, Sash/Sturdy/Disguise/Ice Face at full HP);
  Grassy Glide is +1 for a grounded user in Grassy Terrain, so Armor Tail / Queenly
  Majesty / Dazzling block it (the library let Rillaboom's 99%-usage Grassy Glide "hit" Farigiraf in its
  own Grassy Surge); Assurance's Parental Bond child doubles (the library reads the DEFENDER's ability).
- **A move that faints its user has ONE use** (Explosion, Self-Destruct, Misty Explosion, Final Gambit — `MoveFacts.userFaints`): verdict "OHKO" / partial "OHKO · N%" / "No KO", never a later use (Final Gambit read "2HKO"); every KO chance prints via `formatKoChance` ("<1%" / ">99%", never a rounded 0 / 100).
- The Calc's boost controls are MIRRORED (offense = Atk & SpA, defense = Def & SpD), so stage-counting
  moves (Stored Power, Power Trip) get one stat per control in `Calc.tsx` `calcOf` — fed raw, Corviknight's
  Bulk Up +1 read Power Trip at 100 BP instead of 60.
- **PokeAPI move meta is wrong for damage in three ways — all name-keyed now, each whole-index pinned:**
  Sheer Force (its ailment/stat/flinch proxy calls 16 self-drops/binding moves secondaries and misses 25
  real ones; Champions REMOVED Freeze-Dry's — the one intended diff vs the library), Reckless (Wave Crash
  has no recoil there; crash moves have no field), hit counts (Population Bomb and Twin Beam served as
  single-hit — Maushold's 10-hit signature read 1 hit). Darkest Lariat/Sacred Sword ignore Def stages.
- **KO benchmarks now use the real top item** (any item: Knock Off/Poltergeist/Acrobatics read it), the
  library's spelling, genderless, Skill Link on the Move, and the Champions proxies — and a test recomputes
  every baked row with `damage.ts`. The 2026-11-18 re-bake moved 149 of 1226 rows (+4 −19).
- **A Group B pin that hits an early `return` asserts NOTHING and still shows ✓.** The runner skips on missing
  data and on `calcMove.bp !== meta.power`; until 2026-11-17 that second guard silently skipped all 5
  variable-BP pins (library bp 0 vs baked `power: null` — now `meta.power ?? 0`). Prove a new pin RUNS.
- Knock Off's 1.5× needs "is the item removable", and in this format the only un-removable one is a **Mega
  Stone** held by its own Mega. `isMegaStone` (damage.ts) decides by name: ends in `-ite` (+ optional X/Y/**Z**),
  minus **Eviolite**, the one selectable item that ends the same way. @smogon/calc can't be the oracle —
  it has never heard of Champions-original stones (Chimechite, Scovillainite, Meganiumite…) — so the test
  pins the rule against the baked pool: an item ends in `-ite` **iff** only Mega forms ever hold it. The
  **Z** suffix was added for v1.2.0's Z stones (Lucarionite Z…) — until then the pattern stopped at X/Y and
  Knock Off took a bogus 1.5× against a Z Mega holding its own stone. The pool sweep could NOT have caught
  it (no M-C ladder data yet), so the Z stones are hand-pinned in `damage.test.ts`; any future suffix needs
  the same treatment.
- A `<select>` whose `value` matches **no `<option>` renders as the FIRST option**, silently. Mega presets
  carry their stone (`items[0]` is 100% Metagrossite/etc.) but `Calc.tsx`'s fixed `ITEMS` list has no
  stones, so every Mega's Item field read **"None"** while the mon really held the stone — and one tap
  threw it away. `itemOptions` now appends any held item the list lacks. Check this whenever a baked value
  feeds a fixed-option select.
- **Champions' item pool is NOT mainline's, and the calc quietly assumed it was.** Champions has **no
  Choice Band, Choice Specs, Assault Vest, Eviolite, Safety Goggles, Covert Cloak or Booster Energy** —
  only Choice SCARF. Two independent sources agree: Showdown's champions `items.ts` tags all seven
  nonstandard, and across a full ladder month (132 distinct items) not one mon holds any of them while
  Choice Scarf shows on 133. `Calc.tsx`'s `ITEMS` offered all seven, so a trainer could build a calc on
  an item they can never bring. Fixed there — but `damage.ts` still MODELS them (faithful gen9 port; the
  parity test exercises those branches), so don't "clean that up". The pool is baked (`pokemon.json` →
  `itemPool`, 166 items); status holds `ITEMS` to it and the audit every ladder item. Since 2026-11-18
  `ITEMS` also offers EVERY pool item that changes a roll (18 type boosters 4915, 18 resist berries 2048 /
  Ripen 1024 / blocked by Unnerve, Muscle Band / Wise Glasses 4505, Light Ball, Iron Ball) — damage.test
  asserts pool ∋ each, Calc offers each, one parity pin each. Metronome stays out (needs consecutive uses).
- **Every form carries its OWN weight (`BattleForm.weightKg`, 2026-11-18).** Forms had none, so
  `calc-data.ts` gave each Mega its base's: 69 of 84 forms weigh something else (Mega Steelix 740 kg not
  400, Mega Sableye 161 not 11, Mega Metagross 942.9 not 550) and Low Kick / Grass Knot / Heavy Slam /
  Heat Crash used the wrong bracket. **`damage.test.ts` could never see it** — it builds both engines
  from the LIBRARY's species data — so `calc-data.test.ts` now pins the index itself (the app's data
  path) with 6 weight-move parity pins, each proven live against the base weight. The bake cross-checks
  every page/form's PokeAPI weight against Showdown (`rosterCheck.weightMismatches`, status fails);
  `WEIGHT_CHECK_EXCEPTIONS` (now empty) pins both values of any documented exception. **Maushold**
  bakes PokeAPI's `maushold-family-of-three` (ROSTER_TO_POKEAPI_POKEMON, owner call 2026-11-18): 2.3 kg
  and that form's sprite, like Showdown / the ladder / the library — PokeAPI's default is Family of
  Four (2.8); only Appletun's Heavy Slam into it cares (120 vs 100 BP). **@smogon/calc 0.11 lags two Mega
  weights** (Drampa-Mega 185 → 240.5, Eelektross-Mega 160 → 180; PokeAPI = Showdown) — never pick them
  as a weight oracle.
- **Never import `damage.ts` into client code outside `/calc`.** Turbopack keeps the whole module:
  `alwaysCrits()` alone put the engine on every Pokémon page (+19,854 bytes of JS, measured A/B). Engine
  facts the move sheet needs are stamped on SERVER-side in `pokedex.ts` (`MoveSummary.alwaysCrits`,
  never baked) — the sheet says "Always crits" for Frost Breath / Storm Throw (PokeAPI critRate 6, read
  "High crit rate") and Flower Trick (critRate 0, said nothing).
- **PokeAPI serves 0 where there is no number** — power on 8 SV-era status moves (Shed Tail, Tidy Up…)
  and variable Hard Press, accuracy on Dragon Cheer — and the sheet printed "Power 0" / "Acc 0".
  `buildMove` takes `|| null`; status fails on any 0. (`moveToCalcMove` treats 0 and null alike.)
- **Items PokeAPI has no text for read Showdown's** (`pokemon.json` → `itemText`, every pool item at the
  pinned SHA): the Champions-original Mega Stones, Leek and the three Z stones used to ship a generated
  placeholder ("Absolite Z — a held item used in Pokémon Champions."), and the generator's stone
  pattern stopped at X/Y, so the Z stones had no "Mega Stones" category. status checks both.
- Lookup tables in `src/lib` are object literals: read them with `Object.hasOwn` — `natureEffect`
  ("toString" returned a function; a nature can come from a saved set in localStorage),
  `abilityMatchupNotes(["constructor"])` returned Object itself as a note, `defensiveMultiplier` went NaN.
  `vitest.config.ts` mirrors the `@/` alias, so tests can import `pokedex.ts` / `calc-data.ts`.
- v1.2.0 added 12 held items; only two change a damage roll and both are modelled: **Normal Gem**
  (1.3× on Normal moves — the constant is **5325**, NOT the 5324 Life Orb uses; reaching for the wrong
  one shifts the roll array by one and the parity test catches it) and **Air Balloon** (the format's only
  ITEM-granted immunity — Ground moves read "immune", so it lives in `typeEffectiveness`, not a mod
  chain). The four terrain Seeds fire (+1 Def/SpD, and are SPENT) when the calc's Terrain matches.
  Rocky Helmet / Red Card / Eject Button / Binding Band / Terrain Extender / Leek correctly leave the
  number alone.
- **Terrain is modelled (`CalcField.terrain` + the calc's Terrain row) — Reg M-C forced it.** Rillaboom's
  Grassy Surge (#1, ~47%) and Indeedee's Psychic Surge (~26%) put a terrain up in most games, Steel Roller
  reached Mega Metagross's top moves, and the 2026-10-01 refresh went red: the engine rolled full damage
  where @smogon/calc says the move FAILS with no terrain. Ported + hand-pinned (mutation-checked against
  the old engine): grounded 1.3× (5325) Electric/Grass/Psychic, Misty halving Dragon / Grassy halving
  EQ+Bulldoze into grounded targets, Psychic Terrain blocking priority (Fake Out!) into grounded targets,
  Expanding Force / Rising Voltage / Terrain Pulse / Misty Explosion, Seeds. Grounded = not Flying /
  Levitate / Air Balloon, or holding Iron Ball. Moves that fail outright (also Poltergeist into an
  itemless target) set `DamageResult.fails` → the UI's "Fails · reason", distinct from "No effect". Baked
  KO benchmarks stay NEUTRAL-field by design, so Steel Roller has no benchmark rows.
- **Showdown's champions mod is also the patch log**: `git log -- data/mods/champions` (or the GitHub
  commits API) shows what changed when — "Add Champions Regulation M-C" (812501ede8, release day) made
  exactly the 29 Reg M-C newcomers legal; learnsets are datamined from the game ("waiting on personal
  data and learnsets", PR #12114) and the few misses get fixed fast (Male Meowstic, Qwilfish Barb
  Barrage, Sirfetch'd Meteor Assault). `meta.droppedMoves` + a status check catch a ladder move the move
  index can't resolve — the Serebii tables hid King's Shield (89% of Aegislash) and Forest's Curse (44%
  of Trevenant) from the ladder data that way.
- **Champions Stat Points, not EVs.** Real sets use Stat Points (≤32/stat, 66 total); the mapping is
  the app's own (`generate-competitive.mjs:parseSpread`): **`EV = min(252, SP × 8)`**, trimmed ≤508.
  `stat-points.ts` is the single home for it. So `competitive.json.spread.evs` is EV-space (252-style)
  while `teams.json.evs` is raw SP (32-style, straight from the PokéPaste) — do not confuse them. The
  calc's UI edits Stat Points; the engine consumes EVs.

**Design system (keep the discipline)**
- Tokens in `globals.css`: bg #0b0f14, surface(s), accent #ff5350, muted #93a1b0.
- Red = threat semantics only (nav chrome is neutral); green = opportunity (kill shot);
  stat bars use a single-hue amber luminance ramp (colorblind-safe); cyan/sky = "New to
  Champions" (newcomer badge + filter) — deliberately NOT red, so a new mon never reads as a threat.
- 10px type floor; numbers win the hierarchy (big right-rail stats with tiny captions);
  44px touch targets; one-thumb reach; no section earns its place without a mid-battle question
  it answers (the page order IS the priority order: Threat Profile → Speed → stats → … →
  Type Matchups at the bottom by owner request).

**Verification bar for any change**
`npx tsc --noEmit` + `npm run lint` + `npm test` (458 tests) + `npm run build` (277 static pages) must stay
green (data changes: + `npm run status` + `npm run audit -- --offline`), and visual changes get a
`npm run shot` screenshot check at 375px before they're called done.
