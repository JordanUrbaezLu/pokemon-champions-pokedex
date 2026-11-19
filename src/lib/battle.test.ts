import { describe, it, expect } from "vitest";
import {
  lv50Stats,
  speedAnchors,
  applySpeedMods,
  spreadTag,
  getTrapWarnings,
} from "./battle";
import type { PokemonAbility, PokemonStats } from "./types";

const STATS: PokemonStats = {
  hp: 100,
  attack: 100,
  defense: 100,
  specialAttack: 100,
  specialDefense: 100,
  speed: 100,
  total: 600,
};

const ability = (name: string): PokemonAbility => ({
  name,
  displayName: name,
  isHidden: false,
  shortEffect: "",
});

describe("lv50Stats — the Lv50 / 31-IV formula", () => {
  it("computes neutral 0-EV stats (base 100)", () => {
    const s = lv50Stats(STATS, null);
    // non-HP: floor((2*100+31)*50/100)+5 = 115+5 = 120
    expect(s.attack).toBe(120);
    expect(s.speed).toBe(120);
    // HP: 115 + level(50) + 10 = 175
    expect(s.hp).toBe(175);
    // total passes through untouched
    expect(s.total).toBe(600);
  });

  it("applies EVs and a boosting nature", () => {
    const s = lv50Stats(STATS, { nature: "Timid", evs: { spe: 252 } });
    // core = floor((200+31+63)*50/100) = 147; +5 = 152; ×1.1 = 167.2 → 167
    expect(s.speed).toBe(167);
    // Timid lowers Atk: floor((115+5)*0.9) = 108
    expect(s.attack).toBe(108);
  });
});

describe("speedAnchors — provable Lv50 speed bounds", () => {
  it("MAX uses +Spe/252, MIN uses -Spe/0, COMMON is the given spread", () => {
    const a = speedAnchors(STATS, null);
    expect(a.max).toBe(167); // Timid 252
    expect(a.min).toBe(108); // Brave (−Spe) 0 EV → floor(120*0.9)
    expect(a.common).toBeNull();

    const withSpread = speedAnchors(STATS, { nature: "Jolly", evs: { spe: 252 } });
    expect(withSpread.common).toBe(167);
    expect(withSpread.max).toBeGreaterThanOrEqual(withSpread.common!);
    expect(withSpread.min).toBeLessThanOrEqual(withSpread.common!);
  });
});

describe("applySpeedMods — game-order modifiers with flooring", () => {
  it("no active mods is identity", () => {
    expect(applySpeedMods(100, new Set())).toBe(100);
  });
  it("Choice Scarf is ×1.5", () => {
    expect(applySpeedMods(100, new Set(["scarf"]))).toBe(150);
  });
  it("Icy Wind floors (×2/3)", () => {
    expect(applySpeedMods(100, new Set(["icywind"]))).toBe(66);
  });
  it("Scarf + Paralysis chains to ×0.75", () => {
    expect(applySpeedMods(100, new Set(["scarf", "para"]))).toBe(75);
  });
  it("Scarf + Tailwind on an odd Speed keeps the half a sequential floor drops", () => {
    // Game: pokeRound(101 × 3) = 303, not floor(floor(101×1.5)×2) = 302.
    expect(applySpeedMods(101, new Set(["scarf", "tailwind"]))).toBe(303);
  });
  it("Scarf + Tailwind on an even Speed is unchanged (no regression)", () => {
    expect(applySpeedMods(100, new Set(["scarf", "tailwind"]))).toBe(300);
  });
  it("Icy Wind (stage) then Scarf still matches the game", () => {
    // floor(100 × 2/3) = 66, then × 1.5 = 99
    expect(applySpeedMods(100, new Set(["icywind", "scarf"]))).toBe(99);
  });
});

describe("spreadTag — doubles targeting", () => {
  it("maps the doubles-relevant targets", () => {
    expect(spreadTag("all-other-pokemon")).toBe("Spread");
    expect(spreadTag("all-opponents")).toBe("Both foes");
    expect(spreadTag("selected-pokemon")).toBeNull();
    expect(spreadTag(null)).toBeNull();
  });
});

describe("getTrapWarnings — ability misclick guards", () => {
  it("surfaces Contrary (regression: was missing)", () => {
    const w = getTrapWarnings([ability("Contrary")], {
      abilityUsage: { contrary: 99 },
    } as never);
    expect(w).toHaveLength(1);
    expect(w[0].id).toBe("contrary");
    expect(w[0].pct).toBe(99);
    expect(w[0].tone).toBe("red");
  });

  it("surfaces Sturdy (regression: was missing)", () => {
    const w = getTrapWarnings([ability("Sturdy")], {
      abilityUsage: { sturdy: 97 },
    } as never);
    expect(w[0]?.id).toBe("sturdy");
  });

  it("drops abilities the ladder shows are essentially never run (<5%)", () => {
    const w = getTrapWarnings([ability("Levitate")], {
      abilityUsage: { levitate: 3 },
    } as never);
    expect(w).toEqual([]);
  });

  it("keeps intrinsic traps even with no ladder read, and sorts by usage", () => {
    const w = getTrapWarnings([ability("Levitate"), ability("Defiant")], {
      abilityUsage: { defiant: 80 },
    } as never);
    // Defiant (80%) ranks above Levitate (null → treated as lowest).
    expect(w[0].id).toBe("defiant");
    expect(w.map((x) => x.id)).toContain("levitate");
  });
});

describe("getTrapWarnings — prototype-safe", () => {
  it("never treats an inherited member as a trap ability (or its usage)", () => {
    // Before: TRAP_ABILITIES["constructor"] is Object itself → a warning with
    // undefined text and tone, and abilityUsage["constructor"] (a function) as its %.
    const names = ["constructor", "Constructor", "toString", "__proto__", "hasOwnProperty"];
    expect(getTrapWarnings(names.map(ability), { abilityUsage: { defiant: 80 } } as never)).toEqual([]);
    expect(getTrapWarnings(names.map(ability))).toEqual([]);
  });

  it("reads usage only from the ladder map's own keys", () => {
    const inherited = Object.create({ defiant: 80 }) as Record<string, number>;
    const w = getTrapWarnings([ability("Defiant")], { abilityUsage: inherited } as never);
    expect(w).toHaveLength(1);
    expect(w[0].pct).toBeNull();
  });
});

// --- Team-preview briefing: ability-aware "Best types" (Astra #15) -------------
import { briefingBestTypes, type BriefingMon } from "./battle";
import { getRosterEntries } from "./pokedex";

const mon = (displayName: string, types: BriefingMon["types"], abilities?: string[]): BriefingMon => ({
  displayName,
  types,
  abilities,
});
const row = (rows: ReturnType<typeof briefingBestTypes>, atk: string) => rows.find((r) => r.atk === atk);

describe("briefingBestTypes", () => {
  const heatRotom = mon("Heat Rotom", ["electric", "fire"], ["levitate"]);
  const megaChimecho = mon("Mega Chimecho", ["psychic", "steel"], ["levitate"]);

  it("a guaranteed immunity never counts: Levitate-only Heat Rotom + Mega Chimecho vs Ground", () => {
    expect(row(briefingBestTypes([heatRotom, megaChimecho], 18), "ground")).toBeUndefined();
  });

  it("unknown abilities (an old pin) keep raw type math — the previous behaviour", () => {
    const rows = briefingBestTypes([{ ...heatRotom, abilities: undefined }, { ...megaChimecho, abilities: [] }], 18);
    expect(row(rows, "ground")).toMatchObject({ hit: 2, quads: 1, score: 3, mayBeImmune: [] });
  });

  it("a POSSIBLE immunity keeps the count but is flagged by name", () => {
    const orthworm = mon("Orthworm", ["steel"], ["eartheater", "sandveil"]);
    const kingambit = mon("Kingambit", ["dark", "steel"], ["defiant", "supremeoverlord", "pressure"]);
    expect(row(briefingBestTypes([orthworm, kingambit], 18), "ground")).toMatchObject({
      hit: 2,
      mayBeImmune: ["Orthworm"],
    });
  });

  it("Eelevate (Mega Eelektross's only ability) is a Ground immunity too", () => {
    const megaEel = mon("Mega Eelektross", ["electric"], ["eelevate"]);
    const kingambit = mon("Kingambit", ["dark", "steel"], ["defiant", "supremeoverlord", "pressure"]);
    const incineroar = mon("Incineroar", ["fire", "dark"], ["blaze", "intimidate"]);
    expect(row(briefingBestTypes([megaEel, kingambit, incineroar], 18), "ground")).toMatchObject({
      hit: 2,
      mayBeImmune: [],
    });
  });

  it("a guaranteed resist (lone Thick Fat) isn't a super-effective hit", () => {
    const megaVenusaur = mon("Mega Venusaur", ["grass", "poison"], ["thickfat"]);
    const scizor = mon("Scizor", ["bug", "steel"], ["swarm", "technician", "lightmetal"]);
    const rhydon = mon("Rillaboom", ["grass"], ["overgrow", "grassysurge"]);
    // Fire: Scizor 4×, Rillaboom 2×, Mega Venusaur 2× raw but 1× through Thick Fat.
    expect(row(briefingBestTypes([megaVenusaur, scizor, rhydon], 18), "fire")).toMatchObject({
      hit: 2,
      quads: 1,
      mayBeImmune: [],
    });
  });

  it("keeps hit ≥ 2, ranks by hit + quads (ties in type order), top 3", () => {
    const rows = briefingBestTypes([
      mon("A", ["grass", "flying"]),
      mon("B", ["grass", "ground"]),
      mon("C", ["dragon"]),
    ]);
    expect(rows.map((r) => r.atk)).toEqual(["ice", "fire", "flying"]);
    expect(rows[0]).toMatchObject({ hit: 3, quads: 2, score: 5 });
  });

  it("the home list's pins carry their form's abilities (Heat + Wash Rotom from the real roster)", () => {
    const pins = getRosterEntries()
      .filter((e) => e.name === "rotom-heat" || e.name === "rotom-wash")
      .map((e) => e.pin);
    expect(pins).toHaveLength(2);
    for (const p of pins) expect(p.abilities).toEqual(["levitate"]);
    expect(row(briefingBestTypes(pins, 18), "ground")).toBeUndefined();
  });
});
