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

// --- The KO line under "Likely set" (Fable #7) ---------------------------------
import { headlineBenchmark, likelySet, LIKELY_SET_SIZE } from "./threat";
import { getAllPokemon, getCompetitiveByForm, getUnionMoves } from "./pokedex";
import type { MoveBenchmark } from "./types";

const bench = (move: string, ohkoCount: number, twoCount: number): MoveBenchmark => ({
  move,
  ohkoCount,
  twoCount,
  ohko: [],
  two: [],
});

describe("headlineBenchmark — the KO line names a move the set shows", () => {
  it("picks the most lethal verdict among the SHOWN moves, not overall", () => {
    const rows = [bench("heat-wave", 1, 3), bench("solar-beam", 1, 4), bench("hurricane", 2, 9)];
    expect(headlineBenchmark(rows, ["heat-wave", "solar-beam", "protect"])?.move).toBe("solar-beam");
  });
  it("falls back to the best of all only when no shown move has a verdict", () => {
    const rows = [bench("hurricane", 2, 9), bench("dragon-pulse", 0, 1)];
    expect(headlineBenchmark(rows, ["protect", "tailwind"])?.move).toBe("hurricane");
  });
  it("ties go to the earlier baked row (the more-used move)", () => {
    const rows = [bench("a", 1, 0), bench("b", 0, 2), bench("c", 1, 0)];
    expect(headlineBenchmark(rows, ["a", "b", "c"])?.move).toBe("a");
    expect(headlineBenchmark(rows, ["c", "b"])?.move).toBe("b");
  });
  it("no benchmarks → no line", () => {
    expect(headlineBenchmark(undefined, ["a"])).toBeUndefined();
    expect(headlineBenchmark([], ["a"])).toBeUndefined();
  });
});

describe("likelySet", () => {
  const mv = (name: string) => ({ name });
  it("orders by usage, keeps movepool order on ties, caps at six", () => {
    const moves = ["a", "b", "c", "d", "e", "f", "g", "h"].map(mv);
    const usage = { h: 90, a: 50, b: 50, c: 40, d: 30, e: 20, f: 10, g: 5 };
    expect(likelySet(moves, usage).map((m) => m.name)).toEqual(["h", "a", "b", "c", "d", "e"]);
    expect(LIKELY_SET_SIZE).toBe(6);
  });
  it("skips moves the ladder doesn't record (and inherited keys)", () => {
    expect(likelySet([mv("a"), mv("constructor")], { a: 1 }).map((m) => m.name)).toEqual(["a"]);
    expect(likelySet([mv("a")], undefined)).toEqual([]);
    expect(likelySet([mv("a")], {})).toEqual([]);
  });
});

describe("headline KO line on the real baked data", () => {
  // Every Master+ profile with baked verdicts, exactly as the detail page feeds
  // the card: union movepool + the form's own moveUsage + benchmarks.
  const profiles = getAllPokemon().flatMap((p) => {
    const moves = getUnionMoves(p);
    return Object.entries(getCompetitiveByForm(p, "master"))
      .filter(([, c]) => c.benchmarks?.length)
      .map(([key, c]) => ({ key, c, shown: likelySet(moves, c.moveUsage).map((m) => m.name) }));
  });

  it("covers the baked profiles", () => {
    expect(profiles.length).toBeGreaterThan(200);
  });

  it("Mega Charizard Y headlines a shown move, not its 8% Hurricane", () => {
    const zard = profiles.find((x) => x.key === "charizard-mega-y");
    expect(zard).toBeDefined();
    expect(zard!.shown).not.toContain("hurricane");
    const pick = headlineBenchmark(zard!.c.benchmarks, zard!.shown);
    expect(pick?.move).not.toBe("hurricane");
    expect(zard!.shown).toContain(pick?.move);
  });

  it("headlines an unshown move ONLY when no shown move has a verdict", () => {
    const offenders = profiles.filter(({ c, shown }) => {
      const pick = headlineBenchmark(c.benchmarks, shown)!;
      return !shown.includes(pick.move) && c.benchmarks!.some((b) => shown.includes(b.move));
    });
    expect(offenders.map((x) => x.key)).toEqual([]);
  });
});
