# Champions Pokédex

A fast, mobile-first **battle helper** for **Pokémon Champions** (the doubles game on Switch 2).
Built to be opened **mid-battle**: search the opponent's Pokémon and instantly read its type
matchups, stats, abilities, moves, and how it's actually played on the competitive ladder.

Everything is **baked in at build time** — the running app makes **zero network calls**, so it
opens instantly and keeps working on flaky venue Wi-Fi.

## Features

- **Instant search** over the roster — prefix match on a Pokémon's name *or* its base species,
  so `rotom` finds every Rotom form and `ninetales` finds Alolan Ninetales too. The list is
  sorted by **doubles pick rate**, so you open straight into the threats you're most likely to face.
- **Threat Profile** — the headline read on every detail page: what makes THIS Pokémon
  dangerous, computed per-form from the ladder data. Set-up sweeps with the post-boost stats
  worked out ("One Swords Dance from sweeping — Atk 205→410"), raw damage as a percentile of the
  whole meta, Trick Room/Tailwind plans, priority revenge-killing, sleep/disruption, and ability
  traps that punish standard plays (Defiant vs Intimidate, Levitate vs Earthquake). Every
  Pokémon's card is different because every Pokémon threatens differently.
- **Type Matchups** — what it's weak to (4× called out), what it resists, what it's
  immune to. The fastest answer to "what move do I click?".
- **Base stats** with a colored read of the spread, plus the **common EV spread + nature**
  (e.g. *Jolly — Spe↑ SpA↓*).
- **Abilities** annotated with ladder usage %, with the meta-standard one flagged **Most used**.
- **Common items** (top 3 with %, the top one flagged) — tap any for a full description.
- **Moves** = the actual **Champions movepool**. A **Common** filter (default) surfaces what the
  Pokémon actually runs, with per-move usage %. Tap any move for a detail sheet showing power,
  accuracy, priority, **target** (single / both foes / spread), and exact secondary chances
  (e.g. *30% flinch*, *20% −1 Def*).
- **Watch for set-up** — an at-a-glance warning when the opponent commonly runs Swords Dance,
  Calm Mind, Dragon Dance, etc.
- **Common partners** — who it's usually brought alongside (linked).
- **Mega & form toggle** — switch to Mega Evolutions (with their own doubles data); regional and
  Rotom forms are first-class roster entries with their own typing/stats/competitive data.

## Tech stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript** · **Tailwind v4**
- Mobile-only layout, dark theme, fully **static** (every page prerendered via `generateStaticParams`)

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

- **PokeAPI v2** — types, stats, abilities, Mega forms, move/item details.
- **Serebii** (`pokedex-champions`) — the official Champions roster, which Pokémon have Champions
  Megas, and each Pokémon's Champions movepool.
- **Smogon** Champions VGC doubles ladder (`gen9championsvgc2026regma` "chaos" stats) — usage,
  common abilities/items/moves/spreads, set-up threats, and teammates. **Two complete brackets
  are baked** and the app toggles between them client-side (Champion+ is the default):
  - **Champion+** — the top skill cutoff (1760), backfilled per-mon from 1630 only. Mons too
    rare for top-bracket data say so and point at the All toggle.
  - **All ranks** — the whole-ladder file.
- **Pokémon Showdown data files** — move flags, per-form learnsets (incl. pre-evolution chains,
  so egg moves survive the form-correctness filter), and a fallback for moves PokeAPI lacks.

### Updating

- **Roster:** edit `src/data/roster.json` (one PokeAPI slug per line) and run `npm run data`.
- **Competitive snapshot:** `npm run data:comp` **auto-detects the newest published Smogon
  month** for the format, so a plain re-run is always as fresh as the source allows. Pin a
  specific snapshot with `STATS_MONTH=YYYY-MM npm run data:comp` if you ever need to.
- The home header shows the date the data was last generated.

## Caveats

- Competitive data is **ladder-derived** (Smogon's Champions doubles ladder) and updates monthly —
  a guide, not gospel.
- **Champions has no Terastallization**, so no Tera is shown.
- A few **signature moves** (e.g. Aegislash's King's Shield) aren't listed in Serebii's Champions
  movepool tables, so they may be absent from a movepool even though they see ladder play.
- The roster in `src/data/roster.json` was scraped from Serebii; re-run `npm run data` to refresh.

## Project layout

```
scripts/
  generate-dataset.mjs       # roster + movepool (PokeAPI + Serebii)
  generate-competitive.mjs   # ladder usage/sets (Smogon)
src/
  app/                       # routes (home + /pokemon/[name])
  components/                # UI (search, detail sections, modals)
  lib/                       # data access, type chart, formatting, types
  data/                      # roster.json + generated/*.json
```

See `CHECKLIST.md` for the feature/requirements log.
