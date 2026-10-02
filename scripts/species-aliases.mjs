/**
 * Showdown ⇄ roster naming for the forms PokeAPI and Showdown spell differently.
 *
 * The roster uses PokeAPI slugs (`indeedee-female`); Smogon's ladder stats and
 * the forum's sample-team minisprites use Showdown names (`Indeedee-F`,
 * `:indeedee-f:`). For almost every species the two slugify identically — these
 * are the ones that don't. A miss here is SILENT: the mon's page ships with no
 * ladder data, its teammate links go dead and sample teams can't resolve it.
 * That is how Indeedee-F (22% of Reg M-C teams) baked blank on 2026-10-01 —
 * `npm run status` now fails on any ladder species ≥2% that no page claims.
 *
 * Keyed by the slugified Showdown name → our roster slug or battle-form key.
 * Shared by generate-competitive (ladder keys, teammate links) and
 * generate-teams (minisprites).
 */
export const SHOWDOWN_TO_ROSTER = {
  // Form-split roster slugs: PokeAPI has no bare `indeedee` / `toxtricity` /
  // `squawkabilly`, while Showdown names the default form with the bare name.
  indeedee: "indeedee-male",
  "indeedee-f": "indeedee-female",
  toxtricity: "toxtricity-amped",
  squawkabilly: "squawkabilly-green-plumage",
  "squawkabilly-blue": "squawkabilly-blue-plumage",
  "squawkabilly-yellow": "squawkabilly-yellow-plumage",
  "squawkabilly-white": "squawkabilly-white-plumage",
  // Mega Meowstic: the male and female Megas are battle-identical, so the
  // dataset keeps ONE form (generate-dataset collapses the female) — both
  // ladder keys feed it, the higher-usage one winning.
  "meowstic-m-mega": "meowstic-male-mega",
  "meowstic-f-mega": "meowstic-male-mega",
  "basculegion-f": "basculegion-female",
};

/**
 * Forms Smogon's usage stats POOL under the bare species name: there is no
 * "Toxtricity-Low-Key" or "Squawkabilly-Blue" ladder key — every Toxtricity is
 * counted as "Toxtricity" (its entry carries Low Key's Minus) and every plumage
 * as "Squawkabilly" (it carries Yellow/White's Sheer Force). So these are NOT
 * renames: each form borrows the pooled set as an `asForm` profile — honest
 * usage/items/spreads/teammates for the species, with the per-form ability and
 * move tables blanked rather than mislabelled (the audit flags them otherwise).
 *
 * Roster slug → the pooled Showdown slug.
 */
export const STATS_POOLED = {
  "toxtricity-amped": "toxtricity",
  "toxtricity-low-key": "toxtricity",
  "squawkabilly-green-plumage": "squawkabilly",
  "squawkabilly-blue-plumage": "squawkabilly",
  "squawkabilly-yellow-plumage": "squawkabilly",
  "squawkabilly-white-plumage": "squawkabilly",
};

/** Our slug/form key → every Showdown slug that renames it (reverse lookup). */
export const ROSTER_TO_SHOWDOWN = Object.entries(SHOWDOWN_TO_ROSTER).reduce((acc, [showdown, ours]) => {
  (acc[ours] ??= []).push(showdown);
  return acc;
}, {});
