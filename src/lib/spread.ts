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
