/**
 * The compact index the Battle Calc ships to the client.
 *
 * The calc is a full builder — a trainer can pick any roster mon on either side
 * and edit its set — so it needs base stats, abilities, and the damaging
 * movepool for all 226 species. Importing `pokedex.ts` into the client would
 * bundle the ~2.4 MB of raw JSON; instead the (static, build-time) `/calc`
 * server page calls {@link buildCalcIndex} and passes this trimmed projection
 * as props. It carries only what the damage engine + editors read, and each
 * form's ladder-common set as a one-tap **meta preset** (Stat-Point space).
 */

import {
  getAllPokemon,
  getCompetitiveByForm,
  getCompetitiveMeta,
  getMoveBySlug,
  getUnionMoves,
  getDataUpdatedAt,
} from "./pokedex";
import { spreadToStatPoints, type StatPointMap } from "./stat-points";
import type {
  DataBracket,
  MoveSummary,
  PokemonAbility,
  PokemonStats,
  PokemonType,
} from "./types";

/** A move reduced to exactly the fields `moveToCalcMove` + the picker need. */
export type CalcMoveLite = Pick<
  MoveSummary,
  | "displayName" | "type" | "damageClass" | "power" | "target" | "flags"
  | "ailment" | "ailmentChance" | "statChance" | "statChanges"
  | "flinchChance" | "minHits" | "maxHits" | "priority"
> & { slug: string };

export interface CalcPreset {
  nature: string;
  sp: StatPointMap;
  ability: string | null;
  item: string | null;
  /** Damaging moves the ladder shows it running, most-used first (≤4 slugs). */
  topMoves: string[];
}

export interface CalcForm {
  /** null = base form; otherwise the Mega/Primal/stance form key. */
  key: string | null;
  label: string;
  isMega: boolean;
  types: PokemonType[];
  stats: PokemonStats;
  abilities: { name: string; displayName: string }[];
  sprite: string | null;
  /** Species weight (kg) — for weight-based moves (Grass Knot, Heavy Slam, …). */
  weightKg: number;
  /** Smogon/display name — for the verdict caption + calc parity. */
  smogonName: string;
  preset: CalcPreset | null;
}

export interface CalcEntry {
  slug: string;
  name: string;
  forms: CalcForm[];
  /** Damaging move slugs (status excluded), the move picker's option list. */
  moveSlugs: string[];
}

export interface CalcIndex {
  entries: CalcEntry[];
  moves: Record<string, CalcMoveLite>;
  bracketLabel: string;
  /** Short bracket name for tight UI ("Master+" / "All ranks") — the long
   *  bracketLabel truncates mid-word in the calc's 375px sticky header. */
  bracketShort: string;
  /** The bracket's two most-picked mons — the calc's opening matchup, so the
   *  first paint answers a real question instead of an alphabetical accident. */
  defaultSlugs?: [string, string];
  generatedAt: string | null;
}

const stripId = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function liteMove(slug: string): CalcMoveLite | null {
  const m = getMoveBySlug(slug);
  if (!m || m.damageClass === "status") return null;
  return {
    slug,
    displayName: m.displayName,
    type: m.type,
    damageClass: m.damageClass,
    power: m.power,
    target: m.target,
    flags: m.flags ?? [],
    ailment: m.ailment,
    ailmentChance: m.ailmentChance,
    statChance: m.statChance,
    statChanges: m.statChanges,
    flinchChance: m.flinchChance,
    minHits: m.minHits,
    maxHits: m.maxHits,
    priority: m.priority,
  };
}

/** Best display name for an ability id, using the form's own ability list. */
function abilityName(id: string, abilities: { name: string; displayName: string }[]): string | null {
  const hit = abilities.find((a) => stripId(a.name) === id);
  if (hit) return hit.displayName;
  return abilities[0]?.displayName ?? null;
}

function toAbilityPairs(abilities: PokemonAbility[]): { name: string; displayName: string }[] {
  return abilities.map((a) => ({ name: a.name, displayName: a.displayName }));
}

/**
 * Build the client index for a bracket (default Master+ — the sets you face).
 * Runs at build time inside the static `/calc` page.
 */
export function buildCalcIndex(bracket: DataBracket = "master"): CalcIndex {
  const entries: CalcEntry[] = [];
  const moves: Record<string, CalcMoveLite> = {};
  // Each species' best pick rate across its forms — for the default matchup.
  const usageBySlug = new Map<string, number>();

  for (const p of getAllPokemon()) {
    const compByForm = getCompetitiveByForm(p, bracket);
    usageBySlug.set(
      p.name,
      Math.max(0, ...Object.values(compByForm).map((c) => c?.usagePct ?? 0)),
    );

    const damaging = getUnionMoves(p).filter((m) => m.damageClass !== "status");
    const moveSlugs: string[] = [];
    for (const m of damaging) {
      if (!moves[m.name]) {
        const lite = liteMove(m.name);
        if (lite) moves[m.name] = lite;
      }
      moveSlugs.push(m.name);
    }

    const baseForm: CalcForm = buildForm(
      { key: null, label: p.displayName, isMega: false, types: p.types, stats: p.stats, abilities: p.abilities, sprite: p.home ?? p.sprite, weightKg: p.weightKg },
      compByForm[p.name],
      p.name,
    );
    const altForms: CalcForm[] = p.forms.map((f) =>
      buildForm(
        {
          key: f.key,
          label: f.label,
          isMega: f.kind === "mega" || f.kind === "primal",
          types: f.types,
          stats: f.stats,
          abilities: f.abilities,
          sprite: f.artwork ?? f.sprite ?? p.home ?? p.sprite,
          weightKg: p.weightKg,
        },
        compByForm[f.key],
        f.key,
      ),
    );

    entries.push({ slug: p.name, name: p.displayName, forms: [baseForm, ...altForms], moveSlugs });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  const topPicked = [...usageBySlug.entries()]
    .filter(([, pct]) => pct > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([slug]) => slug);

  const meta = getCompetitiveMeta();
  return {
    entries,
    moves,
    bracketLabel: meta.bracketLabels?.[bracket] ?? (bracket === "master" ? "Master+" : "All ranks"),
    bracketShort: bracket === "master" ? "Master+" : "All ranks",
    defaultSlugs:
      topPicked.length === 2 ? [topPicked[0], topPicked[1]] : undefined,
    generatedAt: getDataUpdatedAt(),
  };
}

function buildForm(
  raw: {
    key: string | null; label: string; isMega: boolean;
    types: PokemonType[]; stats: PokemonStats; abilities: PokemonAbility[]; sprite: string | null;
    weightKg: number;
  },
  comp: ReturnType<typeof getCompetitiveByForm>[string] | undefined,
  smogonKey: string,
): CalcForm {
  const abilities = toAbilityPairs(raw.abilities);
  let preset: CalcPreset | null = null;
  if (comp?.spread) {
    let topAbilityId: string | null = null;
    let bestPct = -1;
    for (const [id, pct] of Object.entries(comp.abilityUsage ?? {})) {
      if (pct > bestPct) { topAbilityId = id; bestPct = pct; }
    }
    const topMoves = Object.entries(comp.moveUsage ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([slug]) => slug)
      .filter((slug) => {
        const m = getMoveBySlug(slug);
        return m && m.damageClass !== "status" && m.power != null;
      })
      .slice(0, 4);
    preset = {
      nature: comp.spread.nature,
      sp: spreadToStatPoints(comp.spread),
      ability: topAbilityId ? abilityName(topAbilityId, abilities) : abilities[0]?.displayName ?? null,
      item: comp.items?.[0]?.displayName ?? null,
      topMoves,
    };
  }
  return {
    key: raw.key,
    label: raw.label,
    isMega: raw.isMega,
    types: raw.types,
    stats: raw.stats,
    abilities,
    sprite: raw.sprite,
    weightKg: raw.weightKg,
    smogonName: comp?.smogonName ?? smogonKey,
    preset,
  };
}
