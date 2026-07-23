# Champions Pokédex — Requirements Checklist

A living log of everything requested + built. Legend: ✅ done · 🔄 in progress · ⏳ planned.

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

## Optional / not done
- ⏳ Download HOME sprites locally for fully offline images (data is already local; deferred as
  repo bloat vs the ~80ms prod nav already in place)

## Project docs
- ✅ README.md · ✅ this checklist
