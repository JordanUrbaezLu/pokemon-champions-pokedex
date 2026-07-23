import { evToSp } from "./stat-points";
import type { CompetitiveSpread, EvStat } from "./types";

/** Turn a PokeAPI slug ("mr-mime", "charizard") into a display name. */
export function toDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

/** The stat a nature raises/lowers, e.g. Modest -> { up: "SpA", down: "Atk" }. */
export function natureEffect(nature: string): { up: string; down: string } | null {
  return NATURE_EFFECTS[nature] ?? null;
}

/** Every nature name, for a nature picker (neutral ones first). */
export const NATURES: string[] = Object.keys(NATURE_EFFECTS);

/** "Aerodactyl-Mega" -> "Mega Aerodactyl", "Charizard-Mega-Y" -> "Mega Charizard Y". */
export function prettySmogonName(name: string): string {
  const m = name.match(/^(.+)-Mega(-[XY])?$/);
  return m ? `Mega ${m[1]}${m[2] ? ` ${m[2].slice(1)}` : ""}` : name;
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
