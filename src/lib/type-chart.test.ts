import { describe, it, expect } from "vitest";
import {
  defensiveMultiplier,
  defensiveProfile,
  allMatchups,
  abilityMatchupNotes,
  effectiveDefensiveMultiplier,
  effectiveDefensiveProfile,
} from "./type-chart";
import { POKEMON_TYPES } from "./types";

describe("effectiveDefensiveProfile — ability-aware kill-shot read", () => {
  it("no abilities behaves exactly like defensiveProfile", () => {
    const t = ["grass", "dragon"] as const;
    expect(effectiveDefensiveProfile(t)).toEqual(defensiveProfile(t));
  });

  it("Levitate removes the Ground weakness (Heat Rotom must not read 4× Ground)", () => {
    // Electric/Fire is 2×2 = 4× to Ground on type alone.
    expect(defensiveProfile(["electric", "fire"]).quad).toContain("ground");
    const eff = effectiveDefensiveProfile(["electric", "fire"], ["Levitate"]);
    expect(eff.quad).not.toContain("ground");
    expect(eff.weak).not.toContain("ground");
    expect(eff.immune).toContain("ground");
    expect(effectiveDefensiveMultiplier("ground", ["electric", "fire"], ["Levitate"])).toBe(0);
  });

  it("Thick Fat demotes a 4× Ice weakness to 2× (out of the kill-shot)", () => {
    // Grass/Dragon is 2× Ice on type alone... use Grass/Flying for a true 4×.
    expect(defensiveProfile(["grass", "flying"]).quad).toContain("ice");
    const eff = effectiveDefensiveProfile(["grass", "flying"], ["Thick Fat"]);
    expect(eff.quad).not.toContain("ice");
    expect(eff.weak).toContain("ice");
    expect(effectiveDefensiveMultiplier("ice", ["grass", "flying"], ["Thick Fat"])).toBe(2);
  });

  it("takes the worst case across multiple possible abilities", () => {
    // If any listed ability negates Ground, the kill shot can't rely on it.
    const eff = effectiveDefensiveProfile(["electric", "fire"], ["Blaze", "Levitate"]);
    expect(eff.immune).toContain("ground");
  });
});

describe("defensiveMultiplier — canonical single-type matchups", () => {
  it("immunities are 0×", () => {
    expect(defensiveMultiplier("normal", ["ghost"])).toBe(0);
    expect(defensiveMultiplier("fighting", ["ghost"])).toBe(0);
    expect(defensiveMultiplier("ground", ["flying"])).toBe(0);
    expect(defensiveMultiplier("electric", ["ground"])).toBe(0);
    expect(defensiveMultiplier("psychic", ["dark"])).toBe(0);
    expect(defensiveMultiplier("dragon", ["fairy"])).toBe(0);
    expect(defensiveMultiplier("ghost", ["normal"])).toBe(0);
    expect(defensiveMultiplier("poison", ["steel"])).toBe(0);
  });

  it("super-effective is 2×", () => {
    expect(defensiveMultiplier("fire", ["grass"])).toBe(2);
    expect(defensiveMultiplier("water", ["fire"])).toBe(2);
    expect(defensiveMultiplier("ice", ["dragon"])).toBe(2);
    expect(defensiveMultiplier("fighting", ["normal"])).toBe(2);
    expect(defensiveMultiplier("fairy", ["dragon"])).toBe(2);
    expect(defensiveMultiplier("steel", ["fairy"])).toBe(2);
  });

  it("not-very-effective is 0.5×", () => {
    expect(defensiveMultiplier("fire", ["water"])).toBe(0.5);
    expect(defensiveMultiplier("grass", ["fire"])).toBe(0.5);
    expect(defensiveMultiplier("dragon", ["steel"])).toBe(0.5);
  });
});

describe("defensiveMultiplier — dual-type stacking", () => {
  it("stacks to 4× when both types are weak", () => {
    expect(defensiveMultiplier("ice", ["grass", "flying"])).toBe(4);
    expect(defensiveMultiplier("ice", ["dragon", "ground"])).toBe(4);
    expect(defensiveMultiplier("rock", ["fire", "flying"])).toBe(4);
  });

  it("stacks to 0.25× when both types resist", () => {
    expect(defensiveMultiplier("fire", ["fire", "water"])).toBe(0.25);
    expect(defensiveMultiplier("grass", ["grass", "poison"])).toBe(0.25);
  });

  it("a single immunity zeroes the whole product", () => {
    // Ground is 2× on Steel but 0× on Flying (Skarmory) → immune overall.
    expect(defensiveMultiplier("ground", ["steel", "flying"])).toBe(0);
  });
});

describe("defensiveProfile — bucketing", () => {
  it("Fire/Flying reads correctly (Charizard base)", () => {
    const p = defensiveProfile(["fire", "flying"]);
    expect(p.quad).toContain("rock");
    expect(p.weak).toEqual(expect.arrayContaining(["water", "electric"]));
    expect(p.immune).toContain("ground");
    expect(p.doubleResists).toEqual(expect.arrayContaining(["grass", "bug"]));
  });

  it("every type lands in exactly one bucket", () => {
    const p = defensiveProfile(["steel", "psychic"]);
    const total =
      p.quad.length +
      p.weak.length +
      p.resists.length +
      p.doubleResists.length +
      p.immune.length;
    // Neutral types aren't bucketed, so total <= 18; buckets never overlap.
    const all = [
      ...p.quad,
      ...p.weak,
      ...p.resists,
      ...p.doubleResists,
      ...p.immune,
    ];
    expect(new Set(all).size).toBe(all.length);
    expect(total).toBeLessThanOrEqual(POKEMON_TYPES.length);
  });
});

describe("allMatchups", () => {
  it("returns one entry per attacking type", () => {
    const rows = allMatchups(["water"]);
    expect(rows).toHaveLength(POKEMON_TYPES.length);
    expect(rows.find((r) => r.type === "electric")?.multiplier).toBe(2);
    expect(rows.find((r) => r.type === "fire")?.multiplier).toBe(0.5);
  });
});

describe("abilityMatchupNotes — ability-blindness caveats", () => {
  it("flags type-altering abilities with a single note each", () => {
    expect(abilityMatchupNotes(["Levitate"])).toHaveLength(1);
    expect(abilityMatchupNotes(["Levitate"])[0]).toMatch(/Ground/i);
    expect(abilityMatchupNotes(["Flash Fire"])[0]).toMatch(/Fire/i);
  });

  it("accepts slug or display form, and de-dupes", () => {
    expect(abilityMatchupNotes(["thick-fat"])[0]).toMatch(/Fire and Ice/i);
    expect(abilityMatchupNotes(["Levitate", "levitate"])).toHaveLength(1);
  });

  it("returns nothing for abilities that don't change type math", () => {
    expect(abilityMatchupNotes(["Overgrow", "Blaze"])).toEqual([]);
    expect(abilityMatchupNotes([])).toEqual([]);
  });
});
