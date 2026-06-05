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
