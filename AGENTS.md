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

**Hard constraints**
- Mobile-only (375px first), dark theme, fully static: every page prerendered, **zero runtime
  API calls** (only the sprite CDN, which the service worker caches). Client JS stays small.
- Data is baked at build into `src/data/generated/{pokemon,competitive,teams}.json` (committed).
  `roster.json` is the source of truth: `roster` = every species (PokeAPI slugs), `newcomers` =
  recently-added species the generator stamps `isNew` on (drives the NEW badge + home filter).
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
  `bracket.ts` + `opponents.ts` (localStorage stores), `format.ts`, `types.ts`.
  Calc engine: `damage.ts` (client-side gen9 damage formula), `spread.ts` (shared spread-move
  predicate), `stat-points.ts` (Champions Stat Points ↔ EVs), `calc-data.ts` (the `/calc` index).
  UI sheets (move/item/briefing) share `src/components/Sheet.tsx` — see hard-won facts.
- `scripts/`: `generate-dataset.mjs` (roster/movepools/moves), `generate-competitive.mjs`
  (both ladder brackets + baked KO benchmarks via @smogon/calc), `generate-teams.mjs` (real meta teams
  from Smogon's sample-teams thread → `teams.json`), `status.mjs`, `screenshot.mjs`.
- `CHECKLIST.md` = living log of everything requested/built. `README.md` = user-facing.

**Commands**
- `npm run dev` / `npm run build && npm run start` (prod).
- `npm run data` / `npm run data:comp` / `npm run data:teams` / `npm run data:all` — re-bake data.
  `data:all` runs all three in order (teams last — it reads the fresh competitive.json for usage +
  form resolution). The competitive
  script **auto-detects both the current ladder REGULATION and the newest published Smogon
  month** — it reads each month's chaos index newest-first and takes the highest-lettered
  `gen9championsvgc2026regm*` (…regmb > …regma), so a game regulation rotation needs no code edit.
  Pin either: `STATS_FORMAT=gen9championsvgc2026regmb` / `STATS_MONTH=YYYY-MM`. (Currently Reg M-B.)
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
That's the entire contract. The weekly Action runs `refresh` and opens/auto-merges the data PR.
- `npm run shot -- /pokemon/kingambit out.png` — 375px screenshot of a running app
  (`PORT=3210` env to target another port). Use it after every visual change.
- A weekly GitHub Action (`.github/workflows/refresh-data.yml`, Mondays 09:00 UTC) runs the same
  `npm run refresh`, opens a PR with the data diff, and **auto-merges it when green** (manual run:
  Actions tab → Run workflow, optional `stats_month` to pin). **One-time repo setting required:**
  Settings → Actions → General → Workflow permissions → enable *"Allow GitHub Actions to create and
  approve pull requests"* — without it the PR step fails with *"not permitted to create pull requests"*.

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
- Chaos cutoffs: 0 / 1500 / 1630 / 1760. High-cutoff files **weight** Moves/Teammates/Spreads
  tables but NOT `Raw count` — per-set rates must divide by the weighted set count (the
  Abilities-table sum), or every % silently becomes 0 at 1760.
- Brackets: `master` = 1760 backfilled per-mon from 1630 only; `all` = whole ladder. Both are
  fully baked; the toggle (home only, default Master+) switches client-side. KO benchmarks are
  baked for the `master` bracket only.
- PokeAPI per-form learnsets have holes (e.g. Freeze-Dry missing on ninetales-alola) and egg/
  prevo moves live only on pre-evolutions — the movepool filter unions PokeAPI ∪ Showdown
  learnsets **including the Showdown prevo chain**. Tera moves are excluded everywhere.
- PokeAPI sometimes 502s persistently on single endpoints; the generator salvages those entries
  from the committed dataset and logs it. Patient exponential backoff is already in place.
- Serebii variant forms (Alolan, Rotom appliances) share the base species' page; the page is a
  multi-form union — hence the learnset intersection. Serebii HTML needs `grep -a` (stray bytes).
- PokeAPI serves several **Champions-original Megas with `abilities: []`** (Mega Eelektross,
  Staraptor, Pyroar, Scolipede, Dragalge, Malamar, Scrafty, Barbaracle, Falinks). A Mega's ability
  is its single most battle-defining fact, so `MEGA_FORM_ABILITIES` in `generate-dataset.mjs`
  curates them from Serebii (incl. Champions-only abilities **Eelevate**, **Fire Mane** that no
  PokeAPI/Showdown entry has). `npm run status` asserts every battle form ships an ability+effect.
- Puppeteer's `setOfflineMode` does NOT apply to service workers — to test offline for real,
  prime the cache, kill the server, then navigate.
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
  (base damage, bp/at/df/final mod chains, `pokeRound`, 16-roll), scoped to this format's mechanics —
  so an interactive calc ships with **zero** @smogon/calc in the client bundle. `damage.test.ts` keeps
  it honest: it computes a broad meta sample with BOTH the real library AND `damage.ts` and asserts the
  16-roll arrays match **exactly** (300+ cases + one per modeled ability/field). If the port drifts, CI
  goes red — treat that test as the spec. It stays EV-model (via `lv50Stats`), so calc numbers equal the
  app's baked benchmarks + Speed reads. Special cases already handled: Psyshock/Psystrike/Secret Sword
  (hit Def), Foul Play (defender's Atk), Freeze-Dry (2× Water), Acrobatics (×2 no item), and the
  variable-BP moves Grass Knot/Low Kick (target weight), Heavy Slam/Heat Crash (weight ratio), Gyro
  Ball/Electro Ball (speed) — see `VARIABLE_MOVES`. Truly situational ones (Counter, Fissure, Fling,
  Endeavor…) stay "not calculated". Saved calc sets live in `calc-sets.ts` (localStorage, like the tray).
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
`npx tsc --noEmit` + `npm run lint` + `npm test` + `npm run build` (247 static pages) must stay
green, and visual changes get a `npm run shot` screenshot check at 375px before they're called done.
