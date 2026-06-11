# Champions Pokédex — Requirements Checklist

A living log of everything requested + built. Legend: ✅ done · 🔄 in progress · ⏳ planned.

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
- ✅ **Competitive data = Champions DOUBLES ladder** (`gen9championsvgc2026regma`, 2026-05,
  3.36M battles); per-form

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

## Not available
- ❌ **Checks & Counters** — the Champions doubles ladder dump ships none (empty for all mons)
- ❌ **Tera** — Champions has no Terastallization

## Reviews
- ✅ Multi-lens UX + mid-battle review → top improvements implemented
- ✅ Final adversarial code review (18 agents, 14 findings raised) → **0 confirmed**; clean

## Optional / not done
- ⏳ Download HOME sprites locally for fully offline images (data is already local; deferred as
  repo bloat vs the ~80ms prod nav already in place)

## Project docs
- ✅ README.md · ✅ this checklist
