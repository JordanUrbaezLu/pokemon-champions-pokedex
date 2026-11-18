import { evToSp } from "./stat-points";
import type { CompetitiveSpread, EvStat } from "./types";

/** Turn a PokeAPI slug ("mr-mime", "charizard") into a display name. */
export function toDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * A name reduced to its letters and digits, for search: "U-turn", "u turn",
 * "u-turn" and "uturn" all read "uturn"; "King's Rock" / "kings rock" →
 * "kingsrock"; "Farfetch’d" → "farfetchd"; "Flabébé" → "flabebe". The baked
 * names are the OFFICIAL ones (punctuation included) since 2026-11-18 — the
 * slug rule dropped it ("U Turn") — so a typed query must never need it.
 */
export function searchKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Zero-padded National Dex number, e.g. 6 -> "#006". */
export function dexNumber(id: number): string {
  return `#${String(id).padStart(3, "0")}`;
}

/** Short, battle-facing label for each stat. */
export const STAT_LABELS = {
  hp: "HP",
  attack: "Atk",
  defense: "Def",
  specialAttack: "SpA",
  specialDefense: "SpD",
  speed: "Spe",
} as const;

export type StatKey = keyof typeof STAT_LABELS;

/** Render a defensive multiplier the way a trainer reads it: "4×", "½×", "0×". */
export function formatMultiplier(multiplier: number): string {
  if (multiplier === 0) return "0×";
  if (multiplier === 0.25) return "¼×";
  if (multiplier === 0.5) return "½×";
  return `${multiplier}×`;
}

const EV_LABELS: Record<EvStat, string> = {
  hp: "HP",
  atk: "Atk",
  def: "Def",
  spa: "SpA",
  spd: "SpD",
  spe: "Spe",
};
const EV_ORDER: EvStat[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** What each nature boosts/lowers (HP is never affected); null = neutral. */
const NATURE_EFFECTS: Record<string, { up: string; down: string } | null> = {
  Hardy: null, Docile: null, Serious: null, Bashful: null, Quirky: null,
  Lonely: { up: "Atk", down: "Def" }, Brave: { up: "Atk", down: "Spe" },
  Adamant: { up: "Atk", down: "SpA" }, Naughty: { up: "Atk", down: "SpD" },
  Bold: { up: "Def", down: "Atk" }, Relaxed: { up: "Def", down: "Spe" },
  Impish: { up: "Def", down: "SpA" }, Lax: { up: "Def", down: "SpD" },
  Timid: { up: "Spe", down: "Atk" }, Hasty: { up: "Spe", down: "Def" },
  Jolly: { up: "Spe", down: "SpA" }, Naive: { up: "Spe", down: "SpD" },
  Modest: { up: "SpA", down: "Atk" }, Mild: { up: "SpA", down: "Def" },
  Quiet: { up: "SpA", down: "Spe" }, Rash: { up: "SpA", down: "SpD" },
  Calm: { up: "SpD", down: "Atk" }, Gentle: { up: "SpD", down: "Def" },
  Sassy: { up: "SpD", down: "Spe" }, Careful: { up: "SpD", down: "SpA" },
};

/**
 * The stat a nature raises/lowers, e.g. Modest -> { up: "SpA", down: "Atk" }.
 * Own keys only: the table is an object literal, so a bare lookup let
 * `natureEffect("toString")` return Object.prototype's function — and a nature
 * can arrive from a saved calc set in localStorage, i.e. from anywhere.
 */
export function natureEffect(nature: string): { up: string; down: string } | null {
  return Object.hasOwn(NATURE_EFFECTS, nature) ? NATURE_EFFECTS[nature] : null;
}

/** Every nature name, for a nature picker (neutral ones first). */
export const NATURES: string[] = Object.keys(NATURE_EFFECTS);

const REGIONAL_PREFIX: Record<string, string> = {
  Alola: "Alolan",
  Galar: "Galarian",
  Hisui: "Hisuian",
  Paldea: "Paldean",
};

/**
 * A Showdown/Smogon species name (teammate chips, KO-benchmark lists) in the
 * app's own naming — the same words as the page and form labels:
 *   "Aerodactyl-Mega" -> "Mega Aerodactyl", "Charizard-Mega-Y" -> "Mega Charizard Y",
 *   "Garchomp-Mega-Z" -> "Mega Garchomp Z" (v1.2.0's Z Megas — the old X/Y-only
 *   pattern printed them raw), "Meowstic-F-Mega" -> "Mega Meowstic" (one form:
 *   the two genders' Megas are battle-identical), "Kyogre-Primal" -> "Primal Kyogre",
 *   "Ninetales-Alola" -> "Alolan Ninetales", "Tauros-Paldea-Aqua" ->
 *   "Paldean Tauros (Aqua)", "Rotom-Wash" -> "Wash Rotom".
 * Anything else is already a readable name and passes through untouched —
 * Showdown's own form names (Indeedee-F, Aegislash-Blade) and real hyphens
 * (Kommo-o, Porygon-Z, Ho-Oh).
 */
export function prettySmogonName(name: string): string {
  const mega = name.match(/^(.+?)(?:-[MF])?-Mega(?:-([A-Z]))?$/);
  if (mega) return `Mega ${mega[1]}${mega[2] ? ` ${mega[2]}` : ""}`;
  const primal = name.match(/^(.+)-Primal$/);
  if (primal) return `Primal ${primal[1]}`;
  const regional = name.match(/^(.+?)-(Alola|Galar|Hisui|Paldea)(?:-(.+))?$/);
  if (regional) {
    const breed = regional[3] ? ` (${regional[3]})` : "";
    return `${REGIONAL_PREFIX[regional[2]]} ${regional[1]}${breed}`;
  }
  const rotom = name.match(/^Rotom-(Wash|Heat|Frost|Mow|Fan)$/);
  if (rotom) return `${rotom[1]} Rotom`;
  return name;
}

/**
 * Short tab/pill label for a Mega or Primal form, from its full label:
 * "Mega Charizard X" -> "Mega X", "Mega Lucario Z" -> "Mega Z",
 * "Mega Gengar" -> "Mega", "Primal Groudon" -> "Primal". The suffix letter is
 * read generically — a species can hold BOTH a plain Mega and a Mega Z since
 * v1.2.0, and an X/Y-only read labelled both of Lucario's pills "Mega".
 */
export function megaTabLabel(label: string): string {
  if (label.startsWith("Primal")) return "Primal";
  const letter = label.match(/ ([A-Z])$/);
  return letter ? `Mega ${letter[1]}` : "Mega";
}

/**
 * The Battle Calc's form pill ("Base", "Mega X", "Mega Z", "Primal", or a stance
 * form's own label) — what Calc.tsx's form toggle shows in its narrow column.
 */
export function formPillLabel(form: { key: string | null; label: string; isMega: boolean }): string {
  if (!form.key) return "Base";
  return form.isMega ? megaTabLabel(form.label) : form.label;
}

/** Pick rate shown consistently: "26%", "<1%" for tiny shares, "0%" for none. */
export function formatPickRate(pct: number): string {
  if (pct >= 1) return `${Math.round(pct)}%`;
  return pct > 0 ? "<1%" : "0%";
}

/** "252 Atk / 252 Spe / 4 SpD" from a competitive EV spread. */
export function formatSpread(spread: CompetitiveSpread): string {
  return EV_ORDER.filter((k) => spread.evs[k])
    .map((k) => `${spread.evs[k]} ${EV_LABELS[k]}`)
    .join(" / ");
}

/**
 * The same spread in Champions' own unit: "32 HP / 32 Atk / 1 SpD SP".
 * The game shows Stat Points, not EVs — and this matches the "+N" annotations
 * on the stat bars, so the caption and the bars finally speak one language.
 */
export function formatSpreadSp(spread: CompetitiveSpread): string {
  const parts = EV_ORDER.filter((k) => spread.evs[k]).map(
    (k) => `${evToSp(spread.evs[k]!)} ${EV_LABELS[k]}`,
  );
  return parts.length ? `${parts.join(" / ")} SP` : "";
}
