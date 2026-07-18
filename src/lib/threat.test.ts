import { describe, it, expect } from "vitest";
import { getThreatProfile, type MetaDistribution } from "./threat";
import type {
  CompetitiveProfile,
  MoveSummary,
  PokemonStats,
  PokemonType,
} from "./types";

const STATS: PokemonStats = {
  hp: 100,
  attack: 100,
  defense: 100,
  specialAttack: 100,
  specialDefense: 100,
  speed: 100,
  total: 600,
};

// live (0-EV neutral) attack / SpA at Lv50 for base 100 = 120 (see battle.test).
const LIVE_100 = 120;

const EMPTY_META: MetaDistribution = {
  offense: [],
  speed: [],
  physBulk: [],
  specBulk: [],
};

function move(partial: Partial<MoveSummary> & { name: string }): MoveSummary {
  return {
    displayName: partial.name,
    type: "normal",
    damageClass: "status",
    power: null,
    accuracy: null,
    pp: null,
    priority: 0,
    shortEffect: "",
    effect: "",
    target: null,
    ailment: null,
    ailmentChance: 0,
    statChanges: [],
    statChance: 0,
    healing: 0,
    drain: 0,
    flinchChance: 0,
    critRate: 0,
    minHits: null,
    maxHits: null,
    ...partial,
  };
}

function comp(partial: Partial<CompetitiveProfile>): CompetitiveProfile {
  return {
    usagePct: 10,
    rawCount: 100,
    asForm: null,
    abilityUsage: {},
    moveUsage: {},
    items: [],
    spread: null,
    teammates: [],
    setupThreats: [],
    ...partial,
  };
}

function profile(
  types: PokemonType[],
  moveUsage: Record<string, number>,
  moves: MoveSummary[],
  meta: MetaDistribution = EMPTY_META,
  extra: Partial<CompetitiveProfile> = {},
) {
  return getThreatProfile(
    { types, stats: STATS, abilities: [], comp: comp({ moveUsage, ...extra }), moves },
    meta,
  );
}

describe("set-up sweep classification", () => {
  it("Ghost-type Curse is NOT a set-up sweep (regression)", () => {
    const p = profile(
      ["ghost"],
      { curse: 40 },
      [move({ name: "curse", displayName: "Curse" })],
    );
    expect(p.vectors.every((v) => v.kind !== "setup")).toBe(true);
  });

  it("non-Ghost Curse IS a set-up read with correct post-boost Atk", () => {
    const p = profile(
      ["ground"],
      { curse: 40 },
      [move({ name: "curse", displayName: "Curse" })],
    );
    const setup = p.vectors.find((v) => v.kind === "setup");
    expect(setup).toBeDefined();
    // Curse: +1 Atk stage = 1.5× → 120 → 180
    expect(setup!.detail).toContain(`${LIVE_100}→${Math.floor(LIVE_100 * 1.5)}`);
  });

  it("Swords Dance doubles Attack (+2 = 2×)", () => {
    const p = profile(
      ["dragon"],
      { "swords-dance": 50 },
      [move({ name: "swords-dance", displayName: "Swords Dance" })],
    );
    const setup = p.vectors.find((v) => v.kind === "setup");
    expect(setup!.detail).toContain(`${LIVE_100}→${LIVE_100 * 2}`);
  });

  it("Tail Glow is +3 SpA stages (2.5×), not 4× (regression)", () => {
    const p = profile(
      ["bug"],
      { "tail-glow": 40 },
      [move({ name: "tail-glow", displayName: "Tail Glow" })],
    );
    const setup = p.vectors.find((v) => v.kind === "setup");
    expect(setup!.detail).toContain(`SpA ${LIVE_100}→${Math.floor(LIVE_100 * 2.5)}`);
    expect(setup!.detail).not.toContain(`${LIVE_100 * 4}`);
  });
});

describe("priority revenge-killing", () => {
  it("recognizes Grassy Glide despite its static priority 0 (Rillaboom regression)", () => {
    const p = profile(
      ["grass"],
      { "grassy-glide": 45 },
      [move({
        name: "grassy-glide",
        displayName: "Grassy Glide",
        type: "grass",
        damageClass: "physical",
        power: 55,
        priority: 0,
      })],
    );
    const prio = p.vectors.find((v) => v.kind === "priority");
    expect(prio).toBeDefined();
    expect(prio!.headline).toContain("Grassy Glide");
  });
});

describe("speed-control: paralysis", () => {
  it("recognizes Glare, not just Thunder Wave (regression)", () => {
    const p = profile(
      ["normal"],
      { glare: 30 },
      [move({ name: "glare", displayName: "Glare" })],
    );
    const para = p.vectors.find(
      (v) => v.kind === "speed-control" && /Glare/.test(v.headline),
    );
    expect(para).toBeDefined();
  });

  it("recognizes Nuzzle", () => {
    const p = profile(
      ["electric"],
      { nuzzle: 40 },
      [move({ name: "nuzzle", displayName: "Nuzzle" })],
    );
    expect(p.vectors.some((v) => /Nuzzle/.test(v.headline))).toBe(true);
  });
});

describe("disruption: guard moves", () => {
  it("Wide Guard surfaces as a disruption read (regression)", () => {
    const p = profile(
      ["rock"],
      { "wide-guard": 40 },
      [move({ name: "wide-guard", displayName: "Wide Guard" })],
    );
    expect(
      p.vectors.some((v) => v.kind === "disruption" && /Wide Guard/.test(v.headline)),
    ).toBe(true);
  });
});

describe("empty-card fallback", () => {
  it("never returns zero vectors when there is ladder usage (regression)", () => {
    const p = profile(
      ["normal"],
      { tackle: 50 },
      [move({ name: "tackle", displayName: "Tackle", damageClass: "physical", power: 40 })],
    );
    expect(p.vectors.length).toBeGreaterThan(0);
    expect(p.vectors[0].kind).toBe("baseline");
    expect(p.vectors[0].headline).toMatch(/Most-used move/);
  });
});
