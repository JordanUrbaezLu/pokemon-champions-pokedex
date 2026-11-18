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

import dataset from "@/data/generated/pokemon.json";
import { isMegaStone, moveToCalcMove } from "./damage";
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
  /** This form's weight (kg) — for weight-based moves (Grass Knot, Heavy Slam, …). */
  weightKg: number;
  /**
   * The LADDER name the preset's data is shown for ("data shown for"
   * attribution only) — it can be ANOTHER form's: Kantonian Tauros borrows
   * Tauros-Paldea-Aqua's Master+ set, Gourgeist borrows Gourgeist-Super's.
   * Never the engine identity — that is {@link battleName}.
   */
  smogonName: string;
  /**
   * BATTLE IDENTITY: this form's own canonical Showdown species name — what the
   * engine gets as `CalcPokemon.name` (its exact-name rules: Forecast, Raging
   * Bull, Light Ball). Resolved by {@link battleNameOf}, independent of ladder
   * attribution; calc-data.test holds every one to @smogon/calc's species table
   * (same types + base stats as the form).
   */
  battleName: string;
  /**
   * The item this form NEEDS to exist — a Mega's own stone (null otherwise).
   * The calc defaults to it when the form has no preset item and always offers
   * it (Mega Absol has no Master+ set; it opened holding nothing, and with no
   * "Absolite" option Poltergeist read "fails").
   */
  requiredItem: string | null;
  /**
   * Stance Change (Aegislash): the forme it ATTACKS in (Blade) — passed to the
   * engine as `CalcPokemon.attackForm`. Null for every other form.
   */
  attacksAs: { name: string; types: PokemonType[]; baseStats: PokemonStats; weightKg: number } | null;
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

/**
 * Pages/forms whose Showdown species name is NOT their slug title-cased — the
 * renames in `scripts/species-aliases.mjs` (`SHOWDOWN_TO_ROSTER`) plus Floette,
 * whose Champions form is Floette-Eternal (`ROSTER_TO_SHOWDOWN_SPECIES`).
 * calc-data.test.ts holds this table to that file, so the two can't drift.
 */
const SHOWDOWN_SPECIES_NAME: Record<string, string> = {
  floette: "Floette-Eternal",
  "indeedee-male": "Indeedee",
  "indeedee-female": "Indeedee-F",
  "toxtricity-amped": "Toxtricity",
  "squawkabilly-green-plumage": "Squawkabilly",
  "squawkabilly-blue-plumage": "Squawkabilly-Blue",
  "squawkabilly-yellow-plumage": "Squawkabilly-Yellow",
  "squawkabilly-white-plumage": "Squawkabilly-White",
  "meowstic-male-mega": "Meowstic-M-Mega",
  "basculegion-female": "Basculegion-F",
};

/**
 * A page/form's battle identity (`CalcForm.battleName`), in this order:
 *  1. the rename table above;
 *  2. the form's OWN ladder entry (not `asForm`-borrowed) — Showdown's exact
 *     spelling ("Tauros-Paldea-Aqua", "Charizard-Mega-Y", "Farfetch'd");
 *  3. the slug / form key title-cased ("castform" → "Castform", "tauros" →
 *     "Tauros", "absol-mega-z" → "Absol-Mega-Z").
 * A borrowed ladder name (Kantonian Tauros → "Tauros-Paldea-Aqua", Gourgeist →
 * "Gourgeist-Super") is NEVER used: that made the borrowed form fight.
 */
export function battleNameOf(key: string, comp: { smogonName?: string; asForm?: string | null } | undefined): string {
  if (Object.hasOwn(SHOWDOWN_SPECIES_NAME, key)) return SHOWDOWN_SPECIES_NAME[key];
  if (comp?.smogonName && !comp.asForm) return comp.smogonName;
  return key.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("-");
}

const ITEM_POOL = (dataset as unknown as { itemPool: string[] }).itemPool ?? [];
const ITEM_TEXT = (dataset as unknown as { itemText: Record<string, string> }).itemText ?? {};
const MEGA_STONES = ITEM_POOL.filter((it) => isMegaStone(it));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The Mega Stone a Mega form needs (`CalcForm.requiredItem`), in this order:
 *  1. the stone whose Showdown text names this exact form ("…Mega Evolve into
 *     Mega Absol Z in battle." — "into Mega Absol" alone must not match it);
 *  2. the stone the form's own ladder sets hold;
 *  3. the one stone naming the species ("If held by an Eternal Flower Floette…")
 *     when the species has a single Mega.
 * calc-data.test asserts every Mega form gets a distinct pool stone.
 */
function requiredItemOf(
  form: { key: string; label: string },
  comp: { asForm?: string | null; items?: { displayName: string }[] } | undefined,
  speciesName: string,
  megaCount: number,
): string | null {
  const exact = new RegExp(`into ${escapeRe(form.label)}( in battle)?\\.`);
  const byText = MEGA_STONES.filter((st) => exact.test(ITEM_TEXT[st] ?? ""));
  if (byText.length === 1) return byText[0];
  const held = comp && !comp.asForm ? comp.items?.find((it) => isMegaStone(it.displayName)) : undefined;
  if (held) return MEGA_STONES.find((st) => stripId(st) === stripId(held.displayName)) ?? held.displayName;
  if (megaCount === 1) {
    const bySpecies = MEGA_STONES.filter((st) =>
      new RegExp(`held by an? (.+ )?${escapeRe(speciesName)},`).test(ITEM_TEXT[st] ?? ""));
    if (bySpecies.length === 1) return bySpecies[0];
  }
  return null;
}

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

    const megaCount = p.forms.filter((f) => f.kind === "mega" || f.kind === "primal").length;
    const baseForm: CalcForm = buildForm(
      { key: null, label: p.displayName, isMega: false, types: p.types, stats: p.stats, abilities: p.abilities, sprite: p.home ?? p.sprite, weightKg: p.weightKg },
      compByForm[p.name],
      p.name,
      null,
    );
    const altForms: CalcForm[] = p.forms.map((f) => {
      const isMega = f.kind === "mega" || f.kind === "primal";
      return buildForm(
        {
          key: f.key,
          label: f.label,
          isMega,
          types: f.types,
          stats: f.stats,
          abilities: f.abilities,
          sprite: f.artwork ?? f.sprite ?? p.home ?? p.sprite,
          // The form's own weight — until 2026-11-18 every form took the base's
          // (Low Kick into Mega Sableye read 40 BP at 11 kg; it is 161 kg → 100).
          weightKg: f.weightKg,
        },
        compByForm[f.key],
        f.key,
        isMega ? requiredItemOf(f, compByForm[f.key], p.displayName, megaCount) : null,
      );
    });
    const forms = [baseForm, ...altForms];
    // Stance Change: every Aegislash forme attacks as the Blade one.
    const blade = forms.find((f) => f.key?.endsWith("-blade"));
    if (blade) {
      for (const f of forms) {
        if (f.abilities.some((a) => stripId(a.name) === "stancechange")) {
          f.attacksAs = { name: blade.battleName, types: blade.types, baseStats: blade.stats, weightKg: blade.weightKg };
        }
      }
    }

    entries.push({ slug: p.name, name: p.displayName, forms, moveSlugs });
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
  requiredItem: string | null,
): CalcForm {
  const abilities = toAbilityPairs(raw.abilities);
  let preset: CalcPreset | null = null;
  if (comp?.spread) {
    let topAbilityId: string | null = null;
    let bestPct = -1;
    for (const [id, pct] of Object.entries(comp.abilityUsage ?? {})) {
      if (pct > bestPct) { topAbilityId = id; bestPct = pct; }
    }
    // Every move the CALC can compute — the engine's own gate (moveToCalcMove),
    // not "has a nominal power": Final Gambit (Staraptor, 98%), Night Shade
    // (Mega Sableye, 70%), Low Kick… carry power null and were dropped.
    const topMoves = Object.entries(comp.moveUsage ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([slug]) => slug)
      .filter((slug) => {
        const m = getMoveBySlug(slug);
        return !!m && moveToCalcMove(m) != null;
      })
      .slice(0, 4);
    preset = {
      nature: comp.spread.nature,
      sp: spreadToStatPoints(comp.spread),
      ability: topAbilityId ? abilityName(topAbilityId, abilities) : abilities[0]?.displayName ?? null,
      item: comp.items?.[0]?.displayName ?? requiredItem,
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
    battleName: battleNameOf(smogonKey, comp),
    requiredItem,
    attacksAs: null,
    preset,
  };
}
