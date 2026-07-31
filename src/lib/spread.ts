/**
 * The single source of truth for "is this a spread move?" — shared by the
 * client damage engine (`damage.ts`) and, in spirit, the build-time benchmark
 * bake (`scripts/generate-competitive.mjs`, which keeps its own copy because a
 * `.mjs` build tool can't import TS). A spread move hits both foes (and your
 * ally) in doubles and so takes the ×0.75 spread reduction.
 *
 * PokeAPI `target` slugs: "all-other-pokemon" = hits both foes + your ally
 * (e.g. Earthquake, Rock Slide); "all-opponents" = hits both foes only.
 */
export const SPREAD_TARGETS = new Set(["all-opponents", "all-other-pokemon"]);

/** Whether a move applies the doubles ×0.75 spread reduction. */
export function isSpreadMove(target: string | null | undefined): boolean {
  return target != null && SPREAD_TARGETS.has(target);
}

/**
 * The Gen 4+ spread reduction, in Showdown's 4096-space: 3072/4096 = ×0.75.
 * (Gen 3 used ×0.5; free-for-all battles still do — neither applies here.)
 *
 * It multiplies BASE DAMAGE — after the bp/attack/defense chains and the "+2",
 * before weather, crit, STAB, type effectiveness and the final mod chain — and
 * the product is `pokeRound`ed. It is NOT a base-power cut, which is why
 * `effectiveSpreadPower` below is explicitly an approximation.
 *
 * The reduction is keyed on the move actually having 2+ targets when it
 * executes, not on the move's category: Heat Wave into a single remaining foe
 * deals FULL damage. Protect / Wide Guard / immunities do NOT undo it (the
 * target list is frozen before those checks), but a fainted or absent Pokémon
 * does. `damage.ts` models that via `CalcField.singleTarget`.
 */
export const SPREAD_NUMERATOR = 3072;
export const SPREAD_DENOMINATOR = 4096;
export const SPREAD_MULTIPLIER = SPREAD_NUMERATOR / SPREAD_DENOMINATOR; // 0.75

/** How a spread move's targeting reads in the UI. */
export interface SpreadInfo {
  /** PokeAPI target slug this was derived from. */
  target: string;
  /** "all-other-pokemon" also catches YOUR ally — the extra risk to flag. */
  hitsAlly: boolean;
  /** Short pill copy: "Spread" (hits your ally too) or "Both foes". */
  tag: string;
  /** Who it hits, as a sentence fragment. */
  who: string;
}

/**
 * Targeting facts for a spread move, or null for single-target moves.
 *
 * Both spread classes take the IDENTICAL ×0.75 — the target slug only changes
 * WHO gets hit, never the multiplier (verified against Bulbapedia's damage
 * formula and Showdown's `champions` mod, which overrides `modifyDamage` but
 * leaves the spread block byte-identical).
 */
export function spreadInfo(target: string | null | undefined): SpreadInfo | null {
  if (!isSpreadMove(target)) return null;
  const hitsAlly = target === "all-other-pokemon";
  return {
    target: target as string,
    hitsAlly,
    tag: hitsAlly ? "Spread" : "Both foes",
    who: hitsAlly ? "both foes and your ally" : "both foes",
  };
}

/**
 * Base power that would produce roughly the reduced damage — the concrete
 * number the move sheet shows next to the exact ×0.75.
 *
 * APPROXIMATE BY CONSTRUCTION: the real reduction hits base damage after a
 * floor division, so this proxy reads slightly HIGH (never low) — typically by
 * under a point of damage. The UI marks it with "≈" for that reason. Use
 * `computeDamage` for any number that has to be exact.
 */
export function effectiveSpreadPower(power: number | null | undefined): number | null {
  if (power == null || power <= 0) return null;
  return Math.round(power * SPREAD_MULTIPLIER);
}
