/**
 * Champions Stat Points ↔ EVs.
 *
 * Pokémon Champions doesn't use classic 0–252 EVs: a trainer spends **Stat
 * Points** — up to {@link SP_CAP} per stat, {@link SP_BUDGET} total — and the
 * game turns each point into stat gain. The app's whole numeric foundation
 * (`lv50Stats`, the baked `@smogon/calc` KO benchmarks, opponent Speed reads)
 * is EV-model, and `scripts/generate-competitive.mjs` already fixes the bridge:
 *
 *   // values ≤32 are EV/8 buckets
 *   ev = min(252, sp * 8)      // then trimmed to a legal ≤508 total
 *
 * So the calculator speaks Stat Points to the trainer (what the game shows) and
 * converts with the **same rule the build uses**, keeping its numbers identical
 * to the baked benchmarks. This is a documented mapping, not a claim to have
 * reverse-engineered the game's exact internal stat formula — but since we only
 * ever consume it through `lv50Stats`, the calc stays self-consistent with
 * everything else the app renders.
 */

import type { CompetitiveSpread, EvStat } from "./types";

/** Max Stat Points investable in a single stat. */
export const SP_CAP = 32;
/** Total Stat Points a trainer can spend across all six stats. */
export const SP_BUDGET = 66;

export const SP_STATS: EvStat[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** One Stat Point ≈ 8 EVs (the game's granularity), capped at the 252 EV ceiling. */
export function spToEv(sp: number): number {
  return Math.min(252, Math.max(0, Math.round(sp)) * 8);
}

/** EVs → the nearest Stat Point count (for loading an EV-space meta preset). */
export function evToSp(ev: number): number {
  return Math.min(SP_CAP, Math.round(ev / 8));
}

export type StatPointMap = Partial<Record<EvStat, number>>;

/** Total Stat Points spent across a spread. */
export function totalStatPoints(sp: StatPointMap): number {
  return SP_STATS.reduce((sum, k) => sum + (sp[k] ?? 0), 0);
}

/** Stat Points still available to spend. */
export function remainingStatPoints(sp: StatPointMap): number {
  return SP_BUDGET - totalStatPoints(sp);
}

/**
 * Convert a Stat-Point map + nature into the EV-space {@link CompetitiveSpread}
 * the damage engine and `lv50Stats` consume. EVs are trimmed to a legal ≤508
 * total exactly as `parseSpread` does, so a maxed 32/32 spread stays legal.
 */
export function statPointsToSpread(nature: string, sp: StatPointMap): CompetitiveSpread {
  const evs: Partial<Record<EvStat, number>> = {};
  for (const k of SP_STATS) {
    const ev = spToEv(sp[k] ?? 0);
    if (ev > 0) evs[k] = ev;
  }
  let total = SP_STATS.reduce((s, k) => s + (evs[k] ?? 0), 0);
  while (total > 508) {
    const entries = SP_STATS.filter((k) => (evs[k] ?? 0) > 0).sort(
      (a, b) => (evs[a] ?? 0) - (evs[b] ?? 0),
    );
    const k = entries[0];
    const cut = Math.min(evs[k] ?? 0, total - 508);
    evs[k] = (evs[k] ?? 0) - cut;
    if ((evs[k] ?? 0) <= 0) delete evs[k];
    total -= cut;
  }
  return { nature, evs };
}

/** A competitive (EV-space) spread → Stat-Point map, for loading a meta preset. */
export function spreadToStatPoints(spread: CompetitiveSpread): StatPointMap {
  const sp: StatPointMap = {};
  for (const k of SP_STATS) {
    const ev = spread.evs[k];
    if (ev) sp[k] = evToSp(ev);
  }
  return sp;
}
