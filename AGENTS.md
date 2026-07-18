<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Champions Pokédex — project brief (read me first)

**Mission:** the go-to IN-BATTLE helper for Pokémon Champions (doubles, Switch 2 + mobile).
A trainer has 1–2 minutes per decision; every feature is judged by **seconds-to-answer**.
Pre-battle tooling (team builders, etc.) is explicitly out of scope.

**Hard constraints**
- Mobile-only (375px first), dark theme, fully static: every page prerendered, **zero runtime
  API calls** (only the sprite CDN, which the service worker caches). Client JS stays small.
- Data is baked at build into `src/data/generated/{pokemon,competitive}.json` (committed).
  `roster.json` is the source of truth: `roster` = every species (PokeAPI slugs), `newcomers` =
  recently-added species the generator stamps `isNew` on (drives the NEW badge + home filter).
- Champions rules: doubles, Lv 50, fixed 31 IVs, Mega Evolution, **no Terastallization**.
- The in-game top rank is **Master** — the top-bracket data set is called **Master+** in UI
  and `master` in code/data. Never "Champion rank" (Champions is the *game's* name).

**Map**
- `src/app/page.tsx` home (search list) · `src/app/pokemon/[name]/` detail (server page +
  `PokemonDetail.tsx` client) · `src/app/layout.tsx` mounts OpponentTray + SW registrar.
- `src/lib/`: `pokedex.ts` (all data access; bracket-aware), `threat.ts` (Threat Profile
  engine), `battle.ts` (Lv50 math, speed anchors/mods, trap abilities), `type-chart.ts`
  (type math + ability-aware `effectiveDefensiveProfile` for the kill-shot),
  `type-meta.ts` (type colors/labels/order shared by badges, cards, tray),
  `bracket.ts` + `opponents.ts` (localStorage stores), `format.ts`, `types.ts`.
  UI sheets (move/item/briefing) share `src/components/Sheet.tsx` — see hard-won facts.
- `scripts/`: `generate-dataset.mjs` (roster/movepools/moves), `generate-competitive.mjs`
  (both ladder brackets + baked KO benchmarks via @smogon/calc), `status.mjs`, `screenshot.mjs`.
- `CHECKLIST.md` = living log of everything requested/built. `README.md` = user-facing.

**Commands**
- `npm run dev` / `npm run build && npm run start` (prod).
- `npm run data` / `npm run data:comp` / `npm run data:all` — re-bake data. The competitive
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
- `npm test` — Vitest unit suite for the pure logic (type-chart, Lv50 math, threat engine,
  formatters). Node-only, no build. This is the regression net for the weekly data re-bake.
- `npm run shot -- /pokemon/kingambit out.png` — 375px screenshot of a running app
  (`PORT=3210` env to target another port). Use it after every visual change.
- A weekly GitHub Action (`.github/workflows/refresh-data.yml`, Mondays 09:00 UTC) runs the same
  `npm run refresh`, opens a PR with the data diff, and **auto-merges it when green** (manual run:
  Actions tab → Run workflow, optional `stats_month` to pin). **One-time repo setting required:**
  Settings → Actions → General → Workflow permissions → enable *"Allow GitHub Actions to create and
  approve pull requests"* — without it the PR step fails with *"not permitted to create pull requests"*.

**Hard-won facts — do not re-learn these**
- Smogon chaos `Checks and Counters` is **empty for every mon** in this format. Never plan on it.
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
- Damage math foundation: lv50 formula in `battle.ts` (31 IVs); build-time verdicts use
  @smogon/calc (dev-only dep, never shipped). Showdown chaos species names are calc-compatible.

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
`npx tsc --noEmit` + `npm run lint` + `npm test` + `npm run build` (232 static pages) must stay
green, and visual changes get a `npm run shot` screenshot check at 375px before they're called done.
