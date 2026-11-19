# Champions Pokédex

A fast, mobile-first **battle helper** for **Pokémon Champions** (the doubles game on Switch 2).
Built to be opened **mid-battle**: search the opponent's Pokémon and instantly read its type
matchups, stats, abilities, moves, and how it's actually played on the competitive ladder.

Everything is **baked in at build time** — the running app makes **zero network calls**, so it
opens instantly and keeps working on flaky venue Wi-Fi.

## Features

- **Instant search built for the team-preview loop** — prefix, type, and substring matching
  (`gambit` finds Kingambit, `ghost` lists every Ghost), sorted by **doubles pick rate**, with
  the query surviving back-navigation. A **Master+ / All ranks** toggle switches the entire
  app between top-bracket and whole-ladder data instantly.
- **Threat Profile** — the headline read on every detail page: what makes THIS Pokémon
  dangerous, computed per-form from the ladder data. Set-up sweeps with the post-boost stats
  worked out ("One Swords Dance from sweeping — Atk 205→410"), raw damage as a percentile of the
  whole meta, Trick Room/Tailwind plans, priority revenge-killing, sleep/disruption, weather and
  screens, and ability traps that punish standard plays (Defiant vs Intimidate, Levitate vs
  Earthquake) — plus the **likely set** with usage bars, top ability/item, and a green
  **kill-shot strip** when a 4× weakness exists. Every Pokémon's card is different because
  every Pokémon threatens differently.
- **Baked KO benchmarks** — Champions fixes Lv 50 / 31 IVs and the ladder publishes the common
  spreads, so damage is *precomputable*: at build time every likely move runs through the
  Showdown calc engine vs the top meta's common sets. The card shows the danger line ("Play
  Rough OHKOs Garchomp +1 · 2HKOs 8 of the top meta"); tapping any move shows its full
  OHKO/2HKO lists. A damage calculator's answer with zero inputs.
- **Speed panel** — provable Lv. 50 MIN / COMMON / MAX anchors with one-tap Icy Wind / Scarf /
  Tailwind / paralysis / Trick Room modifiers, plus a speed-shape read of the full spread
  distribution ("86% run a −Spe nature — expect Trick Room pace").
- **Opponent tray + briefing** — pin their six at team preview; a persistent dock makes every
  later lookup one tap, and the briefing sheet compresses the preview checklist (per-mon
  archetype + top threat, speed order, best attacking types into their team) to one screen.
- **Type Matchups** — what it's weak to (4× called out), what it resists, what it's
  immune to.
- **Base stats** with a luminance-ramp read of the spread, plus the **common EV spread + nature**
  (e.g. *Jolly — Spe↑ SpA↓*).
- **Abilities** annotated with ladder usage %, with the meta-standard one flagged **Most used**.
- **Common items** (top 3 with %, the top one flagged) — tap any for a full description.
- **Moves** = the actual **Champions movepool**. A **Common** filter surfaces what the
  Pokémon actually runs, with per-move usage %. Tap any move for power, accuracy, priority,
  **target**, exact secondary chances — and its baked KO verdicts vs the top meta.
- **Common partners** — who it's usually brought alongside (linked).
- **Mega & form toggle** — switch to Mega Evolutions (with their own doubles data); regional and
  Rotom forms are first-class roster entries with their own typing/stats/competitive data.

## Tech stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript** · **Tailwind v4**
- Mobile-only layout, dark theme, fully **static** (every page prerendered via `generateStaticParams`)
- **Installable PWA** with a service worker — instant opens and full offline after the first
  visit (cache-first hashed assets/sprites, network-first pages); `launch_handler:
  focus-existing` keeps your place when reopening mid-battle; app shortcuts jump to the top
  three threats
- **@smogon/calc** as a build-time (dev-only) dependency powering the baked KO benchmarks —
  it never ships to the client

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
```

```bash
npm run build && npm run start   # production
```

## Data

The app reads two committed JSON files; it never calls an API at runtime.

| File | Built by | Contents |
| --- | --- | --- |
| `src/data/generated/pokemon.json` | `npm run data` | Roster: types, stats, abilities, Megas, Champions movepool, sprites |
| `src/data/generated/competitive.json` | `npm run data:comp` | Ladder data: usage %, abilities/items/moves/spreads, set-up threats, partners, item details |

Run both with `npm run data:all`.

### Sources

- **PokeAPI v2** — types, stats, abilities, Mega forms, sprites, move/item details (mainline
  values + prose).
- **[Pokémon Showdown](https://github.com/smogon/pokemon-showdown)'s `champions` mod** (MIT,
  © 2011-2026 Guangcong Luo and other contributors) — everything about the game itself: which
  species/forms are legal (the roster is checked against it on every bake), each form's
  Champions movepool, Champions' move changes (power, accuracy, the 8/12/16/20 PP scale,
  secondary chances, flags), move flags and spread targets, the held-item pool, and the
  ability fallback for any Mega PokeAPI serves ability-less. Read at **one pinned commit**
  (`scripts/showdown-data.mjs`) so a re-bake is reproducible; its data files are parsed, never
  executed.
- **Smogon** Champions VGC doubles ladder (`gen9championsvgc2026regmc` "chaos" stats — the
  current Reg M-C; auto-detected, see Updating) — usage,
  common abilities/items/moves/spreads, set-up threats, and teammates. **Two complete brackets
  are baked** and the app toggles between them client-side (Master+ is the default):
  - **Master+** — the top skill cutoff (1760), backfilled per-mon from 1630 only. Mons too
    rare for top-bracket data say so and point at the All toggle.
  - **All ranks** — the whole-ladder file.

### Updating

- **Roster:** edit `src/data/roster.json` (one PokeAPI slug per line) and run `npm run data`.
  `npm run status` fails if the roster and Showdown's Champions-legal set disagree.
- **Showdown commit:** bump `PINNED_SHOWDOWN_SHA` in `scripts/showdown-data.mjs` (try one first
  with `SHOWDOWN_SHA=<sha> npm run data`) to pick up a game patch.
- **Competitive snapshot:** `npm run data:comp` **auto-detects both the current ladder
  regulation and the newest published Smogon month** (it takes the highest-lettered
  `gen9championsvgc2026regm*` that has published — `…regmc` today, a future `…regmd`
  automatically), so a plain re-run tracks the game's regulation with no code edit. Pin a
  specific snapshot with `STATS_FORMAT=… STATS_MONTH=YYYY-MM npm run data:comp` if needed.
- The home header shows the date the data was last generated.

## Caveats

- Competitive data is **ladder-derived** (Smogon's Champions doubles ladder) and updates monthly —
  a guide, not gospel.
- **Champions has no Terastallization**, so no Tera is shown.
- Movepools and move changes are only as current as the **pinned Showdown commit** — a game patch
  lands when someone bumps it (`npm run status` flags a ladder move the pinned learnsets lack).

## Project layout

```
scripts/
  generate-dataset.mjs       # roster + movepool (PokeAPI + Showdown champions mod)
  showdown-data.mjs          # pinned Showdown commit + safe data-file parser
  generate-competitive.mjs   # ladder usage/sets (Smogon)
src/
  app/                       # routes (home + /pokemon/[name])
  components/                # UI (search, detail sections, modals)
  lib/                       # data access, type chart, formatting, types
  data/                      # roster.json + generated/*.json
```

See `CHECKLIST.md` for the feature/requirements log.
