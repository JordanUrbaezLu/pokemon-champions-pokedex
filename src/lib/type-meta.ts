import type { PokemonType } from "./types";

/** Canonical brand color for each Pokémon type, used for badges and accents. */
export const TYPE_COLORS: Record<PokemonType, string> = {
  normal: "#9099a1",
  fire: "#ff9d55",
  water: "#5090d6",
  electric: "#f4d23c",
  grass: "#63bc5a",
  ice: "#73cec0",
  fighting: "#ce4069",
  poison: "#ab6ac8",
  ground: "#d97746",
  flying: "#8fa8dd",
  psychic: "#fa7179",
  bug: "#90c12c",
  rock: "#c7b78b",
  ghost: "#5269ad",
  dragon: "#0b6dc3",
  dark: "#5a5366",
  steel: "#5a8ea1",
  fairy: "#ec8fe6",
};

/**
 * Readable text color (near-black or white) for content laid over a type
 * color, chosen by perceived luminance so badges stay legible.
 */
export function typeTextColor(type: PokemonType): string {
  const hex = TYPE_COLORS[type];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Rec. 601 luma.
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.62 ? "#171717" : "#ffffff";
}
