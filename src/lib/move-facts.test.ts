import { describe, it, expect } from "vitest";
import dataset from "../data/generated/pokemon.json";
import { alwaysCrits } from "./damage";
import { moveFacts } from "./move-facts";
import { getMoveBySlug, getPokemonByName, getUnionMoves } from "./pokedex";
import type { MoveSummary, PokedexDataset } from "./types";

const RAW_MOVES = (dataset as unknown as PokedexDataset).moves;
/** A move as the detail page receives it — through pokedex.ts, flags stamped on. */
const move = (slug: string): MoveSummary => {
  const m = getMoveBySlug(slug);
  if (!m) throw new Error(`no move ${slug}`);
  return m;
};

describe("moveFacts — crit wording on the move sheet", () => {
  it("says 'Always crits' for the guaranteed-crit moves, never 'High crit rate'", () => {
    // PokeAPI serves critRate 6 for these two — they used to read "High crit rate".
    for (const slug of ["frost-breath", "storm-throw"]) {
      expect(move(slug).critRate, slug).toBeGreaterThan(0);
      expect(moveFacts(move(slug)), slug).toContain("Always crits");
      expect(moveFacts(move(slug)), slug).not.toContain("High crit rate");
    }
  });

  it("says 'Always crits' for Flower Trick, whose PokeAPI critRate is 0 (it said nothing)", () => {
    expect(move("flower-trick").critRate).toBe(0);
    expect(moveFacts(move("flower-trick"))).toContain("Always crits");
  });

  it("keeps 'High crit rate' for the ordinary high-crit moves", () => {
    for (const slug of ["leaf-blade", "night-slash", "stone-edge"]) {
      expect(moveFacts(move(slug)), slug).toContain("High crit rate");
      expect(moveFacts(move(slug)), slug).not.toContain("Always crits");
    }
  });

  it("follows the damage engine's always-crit list across the whole move index", () => {
    let always = 0;
    for (const slug of Object.keys(RAW_MOVES)) {
      const facts = moveFacts(move(slug));
      expect(facts.includes("Always crits"), slug).toBe(alwaysCrits(slug));
      expect(facts.includes("Always crits") && facts.includes("High crit rate"), slug).toBe(false);
      if (alwaysCrits(slug)) always++;
    }
    expect(always).toBe(3); // Frost Breath, Flower Trick, Storm Throw in this index
  });

  it("reaches the detail page: its move list (getUnionMoves) carries the engine's flag", () => {
    // What page.tsx hands PokemonDetail → MovesSection → MoveModal.
    const froslass = getPokemonByName("froslass");
    const frostBreath = froslass && getUnionMoves(froslass).find((m) => m.name === "frost-breath");
    expect(frostBreath?.alwaysCrits).toBe(true);
    expect(moveFacts(frostBreath!)).toContain("Always crits");
  });

  it("is stamped on by pokedex.ts, not baked (the raw index has no flag)", () => {
    // A move that skipped pokedex.ts would read the old way — that is the regression.
    expect(RAW_MOVES["frost-breath"].alwaysCrits).toBeUndefined();
    expect(moveFacts(RAW_MOVES["frost-breath"])).toContain("High crit rate");
  });
});
