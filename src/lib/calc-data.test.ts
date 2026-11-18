/**
 * The Battle Calc's index (`buildCalcIndex`) is the app's data path into the
 * damage engine: every number a trainer's calc shows is computed from it.
 * damage.test.ts holds the ENGINE to @smogon/calc — but it builds both sides
 * from the library's own species data, so it could never see the index feed the
 * engine a wrong input. That is exactly how every Mega shipped with its base
 * species' weight (Mega Steelix 400 kg instead of 740, Mega Sableye 11 instead
 * of 161) while the parity suite stayed green. These tests hold the index itself.
 */
import { describe, it, expect } from "vitest";
import { calculate, Field, Generations, Move, Pokemon } from "@smogon/calc";
import competitive from "../data/generated/competitive.json";
import dataset from "../data/generated/pokemon.json";
import { buildCalcIndex, type CalcEntry, type CalcForm } from "./calc-data";
import { computeDamage, isMegaStone, moveToCalcMove, type CalcPokemon } from "./damage";
import { statPointsToSpread } from "./stat-points";
import { formPillLabel } from "./format";
import type { ChampionPokemon, EvStat, MoveSummary } from "./types";
// The same naming table the bake uses (a plain .mjs build script).
import * as aliases from "../../scripts/species-aliases.mjs";

const GEN = Generations.get(9);
const INDEX = buildCalcIndex("master");
const POKEMON = (dataset as unknown as { pokemon: ChampionPokemon[] }).pokemon;
const MOVES = (dataset as unknown as { moves: Record<string, MoveSummary> }).moves;
const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The calc index's form for a page slug (base) or a form key. */
function calcForm(key: string): { entry: CalcEntry; form: CalcForm } {
  for (const entry of INDEX.entries) {
    for (const form of entry.forms) if ((form.key ?? entry.slug) === key) return { entry, form };
  }
  throw new Error(`no calc form ${key}`);
}

describe("calc index — every form carries its OWN weight", () => {
  it("matches the baked page/form weight for all 255 pages and 84 forms", () => {
    let forms = 0;
    for (const p of POKEMON) {
      expect(calcForm(p.name).form.weightKg, p.name).toBe(p.weightKg);
      for (const f of p.forms) {
        expect(f.weightKg, `${f.key} baked weight`).toBeGreaterThan(0);
        expect(calcForm(f.key).form.weightKg, f.key).toBe(f.weightKg);
        forms++;
      }
    }
    expect(forms).toBe(84);
  });

  it("is not the base species' weight (69 of 84 forms weigh something else)", () => {
    const differ = POKEMON.flatMap((p) => p.forms.filter((f) => f.weightKg !== p.weightKg).map((f) => f.key));
    expect(differ.length).toBeGreaterThanOrEqual(69);
    expect(calcForm("steelix-mega").form.weightKg).toBe(740); // Steelix: 400
    expect(calcForm("sableye-mega").form.weightKg).toBe(161); // Sableye: 11
    expect(calcForm("metagross-mega").form.weightKg).toBe(942.9); // Metagross: 550
    expect(calcForm("lucario-mega-z").form.weightKg).toBe(49.4); // lighter than Lucario's 54
  });

  // @smogon/calc 0.11 is the parity oracle, so its species weights are worth
  // knowing exactly. It lags two Champions-original Megas (PokeAPI and Showdown
  // agree on the newer value — the app follows them). (Maushold used to differ:
  // the page now bakes Family of Three like Showdown and the library — see
  // ROSTER_TO_POKEAPI_POKEMON.) Anything new here is a data or library change.
  const KNOWN_LIBRARY_DIFFS: Record<string, { ours: number; library: number }> = {
    "drampa-mega": { ours: 240.5, library: 185 },
    "eelektross-mega": { ours: 180, library: 160 },
  };
  // Each page/form resolves to the species it IS, the way the bake resolves it
  // for Showdown (species-aliases.mjs) — never via the ladder name: a calc
  // preset may borrow another form's set (Gourgeist runs Gourgeist-Super's).
  const toShowdownSpecies = aliases.ROSTER_TO_SHOWDOWN_SPECIES as Record<string, string>;
  const toShowdown = aliases.ROSTER_TO_SHOWDOWN as Record<string, string[]>;
  const librarySpecies = (key: string) =>
    [toShowdownSpecies[key], ...(toShowdown[key] ?? []), key, key.replace(/-breed$/, "")]
      .filter(Boolean)
      .map((n: string) => GEN.species.get(toID(n) as never))
      .find(Boolean);
  it("equals @smogon/calc's species weight, apart from documented differences", () => {
    const diffs: Record<string, { ours: number; library: number }> = {};
    let compared = 0;
    for (const entry of INDEX.entries) {
      for (const form of entry.forms) {
        const key = form.key ?? entry.slug;
        const lib = librarySpecies(key);
        if (!lib) continue; // a name the library spells otherwise (Aegislash = "Aegislash-Shield")
        compared++;
        if (lib.weightkg !== form.weightKg) diffs[key] = { ours: form.weightKg, library: lib.weightkg };
      }
    }
    expect(compared).toBeGreaterThan(330);
    // Subset, not equality: a newer library that catches up must not fail this.
    for (const [key, d] of Object.entries(diffs)) expect(KNOWN_LIBRARY_DIFFS[key], key).toEqual(d);
  });
});

/**
 * One weight-move matchup through BOTH engines: ours fed the calc index's forms
 * (as Calc.tsx's toCalcPokemon does), the library fed its own species data —
 * whose weight for these Megas is the real one (PokeAPI = Showdown = library).
 * Abilities neutral on both sides (Illuminate), so the roll isolates weight.
 */
function weightPin(attackerKey: string, defenderKey: string, moveSlug: string, weightOverride?: { attacker?: number; defender?: number }) {
  const meta = MOVES[moveSlug];
  const move = moveToCalcMove(meta);
  if (!move) throw new Error(`${moveSlug} is not computable`);
  const special = meta.damageClass === "special";
  const sides = [
    { key: attackerKey, nature: special ? "Modest" : "Adamant", evs: special ? { spa: 252 } : { atk: 252 } },
    { key: defenderKey, nature: "Hardy", evs: { hp: 252 } },
  ] as const;
  const [ours, theirs] = [0, 1].map((i) => {
    const { form } = calcForm(sides[i].key);
    const evs = sides[i].evs as Partial<Record<EvStat, number>>;
    const override = i === 0 ? weightOverride?.attacker : weightOverride?.defender;
    const mine: CalcPokemon = {
      name: form.smogonName, types: form.types, baseStats: form.stats, ability: "Illuminate",
      item: null, nature: sides[i].nature, evs, boosts: {}, status: null, curHpPct: 100,
      weightKg: override ?? form.weightKg,
    };
    const lib = new Pokemon(GEN, form.smogonName, {
      level: 50, nature: sides[i].nature, evs, ability: "Illuminate", gender: "N",
    });
    return [mine, lib] as const;
  }).reduce<[CalcPokemon[], Pokemon[]]>((acc, [m, l]) => [[...acc[0], m], [...acc[1], l]], [[], []]);
  const got = computeDamage(ours[0], ours[1], move, { gameType: "Doubles" }).damage;
  const lib = calculate(GEN, theirs[0], theirs[1], new Move(GEN, meta.displayName), new Field({ gameType: "Doubles" }));
  return { got, expected: lib.damage as number[], libBp: lib.move.bp };
}

describe("weight moves from the calc index = @smogon/calc (Mega weights)", () => {
  // Each pin is chosen so the Mega's OWN weight and its base's land in different
  // power brackets — and proves it: rolled with the base weight, it must miss.
  const PINS = [
    // Heavy Slam, attacker's weight: 740 / 83 = 8.9 → 120 BP (400 / 83 = 4.8 → 100).
    { name: "Heavy Slam from Mega Steelix into Incineroar", a: "steelix-mega", d: "incineroar", move: "heavy-slam", baseKg: { attacker: 400 } },
    // Heat Crash, attacker's weight: 320.5 / 95 = 3.4 → 80 BP (220 / 95 = 2.3 → 60).
    { name: "Heat Crash from Mega Camerupt into Garchomp", a: "camerupt-mega", d: "garchomp", move: "heat-crash", baseKg: { attacker: 220 } },
    // Low Kick, target's weight: 100 kg → 100 BP (Kangaskhan's 80 → 80).
    { name: "Low Kick into Mega Kangaskhan", a: "garchomp", d: "kangaskhan-mega", move: "low-kick", baseKg: { defender: 80 } },
    // Grass Knot, target's weight: 161 kg → 100 BP (Sableye's 11 kg → 40). (Not Low Kick: a Ghost.)
    { name: "Grass Knot into Mega Sableye", a: "venusaur-mega", d: "sableye-mega", move: "grass-knot", baseKg: { defender: 11 } },
    // Grass Knot, target's weight: 102 kg → 100 BP (Swampert's 81.9 → 80), 4× on Water/Ground.
    { name: "Grass Knot into Mega Swampert", a: "venusaur-mega", d: "swampert-mega", move: "grass-knot", baseKg: { defender: 81.9 } },
    // Heavy Slam, BOTH weights: 942.9 / 255 = 3.7 → 80 BP (550 / 202 = 2.7 → 60).
    { name: "Heavy Slam from Mega Metagross into Mega Tyranitar", a: "metagross-mega", d: "tyranitar-mega", move: "heavy-slam", baseKg: { attacker: 550, defender: 202 } },
  ];
  for (const pin of PINS) {
    it(pin.name, () => {
      const { got, expected } = weightPin(pin.a, pin.d, pin.move);
      expect(expected).toHaveLength(16);
      expect(got).toEqual(expected);
      // The pin is live: with the base species' weight the engine must disagree.
      expect(weightPin(pin.a, pin.d, pin.move, pin.baseKg).got).not.toEqual(expected);
    });
  }
});

describe("Calc form pills", () => {
  it("never label two forms of one species the same (plain Mega vs Mega Z)", () => {
    // formPillLabel is what Calc.tsx's form toggle renders (its shortFormLabel).
    const pill = (f: CalcForm) => formPillLabel(f);
    for (const entry of INDEX.entries) {
      const pills = entry.forms.map(pill);
      expect(new Set(pills).size, `${entry.slug}: ${pills.join(" / ")}`).toBe(pills.length);
    }
    const lucario = calcForm("lucario").entry.forms.map(pill);
    expect(lucario).toEqual(["Base", "Mega", "Mega Z"]);
    expect(calcForm("charizard").entry.forms.map(pill)).toEqual(["Base", "Mega X", "Mega Y"]);
  });
});

// ---------------------------------------------------------------------------------
// Battle identity (2026-11-18): the engine fought as whatever ladder set a page
// BORROWED — Kantonian Tauros (Master+ data borrowed from Tauros-Paldea-Aqua)
// passed "Tauros-Paldea-Aqua", so Raging Bull turned Water and hit Gengar for
// 70–83; Castform (no Master entry) passed the slug "castform", so the
// exact-name Forecast rule never fired. Every form now carries its OWN
// canonical Showdown name (`battleName`); `smogonName` is attribution only.
// ---------------------------------------------------------------------------------
describe("calc index — every form fights as ITSELF (battleName)", () => {
  // Library spellings / data that differ from Showdown's — each checked live.
  const LIBRARY_NAME: Record<string, string> = {
    // Showdown's base forme is "Aegislash"; the library calls it "Aegislash-Shield".
    aegislash: "Aegislash-Shield",
  };
  const LIBRARY_STAT_LAG = new Set([
    // @smogon/calc 0.11 still carries Mega Starmie's pre-release Atk 140 (Champions/Showdown: 100).
    "starmie-mega",
  ]);
  const statsOf = (s: { hp: number; attack: number; defense: number; specialAttack: number; specialDefense: number; speed: number }) =>
    [s.hp, s.attack, s.defense, s.specialAttack, s.specialDefense, s.speed].join("/");

  it("resolves in @smogon/calc's species table to a species with the form's own types and base stats", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const entry of INDEX.entries) {
      for (const form of entry.forms) {
        const key = form.key ?? entry.slug;
        const lib = GEN.species.get(toID(LIBRARY_NAME[key] ?? form.battleName) as never);
        if (!lib) { bad.push(`${key}: "${form.battleName}" unknown to the library`); continue; }
        checked++;
        const types = (lib.types as readonly string[]).map((t) => t.toLowerCase()).join("/");
        if (types !== form.types.join("/")) bad.push(`${key}: types ${types} ≠ ${form.types.join("/")}`);
        const b = lib.baseStats;
        const libStats = [b.hp, b.atk, b.def, b.spa, b.spd, b.spe].join("/");
        if (libStats !== statsOf(form.stats) && !LIBRARY_STAT_LAG.has(key)) bad.push(`${key}: stats ${libStats} ≠ ${statsOf(form.stats)}`);
      }
    }
    expect(checked).toBeGreaterThan(330);
    expect(bad).toEqual([]);
    // The exceptions are live (a library that catches up turns this red — prune the entry).
    expect(GEN.species.get("aegislash" as never)).toBeUndefined();
    const starmie = GEN.species.get("starmiemega" as never);
    expect(starmie?.baseStats.atk).not.toBe(calcForm("starmie-mega").form.stats.attack);
  });

  it("never takes a borrowed ladder name (Tauros, Gourgeist) and never a raw slug (Castform)", () => {
    expect(calcForm("tauros").form.smogonName).toBe("Tauros-Paldea-Aqua"); // attribution: borrowed set
    expect(calcForm("tauros").form.battleName).toBe("Tauros");
    expect(calcForm("tauros-paldea-aqua-breed").form.battleName).toBe("Tauros-Paldea-Aqua");
    expect(calcForm("gourgeist").form.smogonName).toBe("Gourgeist-Super");
    expect(calcForm("gourgeist").form.battleName).toBe("Gourgeist");
    expect(calcForm("castform").form.battleName).toBe("Castform");
    expect(calcForm("floette").form.battleName).toBe("Floette-Eternal");
    expect(calcForm("charizard-mega-y").form.battleName).toBe("Charizard-Mega-Y");
    expect(calcForm("absol-mega-z").form.battleName).toBe("Absol-Mega-Z");
  });

  it("keeps the rename table in step with scripts/species-aliases.mjs", () => {
    const title = (slug: string) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("-");
    const toShowdown = aliases.ROSTER_TO_SHOWDOWN as Record<string, string[]>;
    const toShowdownSpecies = aliases.ROSTER_TO_SHOWDOWN_SPECIES as Record<string, string>;
    for (const [ours, showdown] of Object.entries(toShowdown)) {
      expect(calcForm(ours).form.battleName, ours).toBe(title(showdown[0]));
    }
    for (const [ours, id] of Object.entries(toShowdownSpecies)) {
      expect(toID(calcForm(ours).form.battleName), ours).toBe(id);
    }
  });

  /** A calc-index form as Calc.tsx's toCalcPokemon builds it (preset set, full HP). */
  const asCalc = (key: string, edits: Partial<CalcPokemon> = {}): CalcPokemon => {
    const { form } = calcForm(key);
    return {
      name: form.battleName, types: form.types, baseStats: form.stats, ability: form.abilities[0]?.displayName ?? null,
      item: null, nature: "Hardy", evs: {}, boosts: {}, status: null, curHpPct: 100, weightKg: form.weightKg,
      attackForm: form.attacksAs ?? undefined, ...edits,
    };
  };

  it("Kantonian Tauros' Raging Bull is Normal: no effect on Gengar (it hit for 70–83 as Paldean Aqua)", () => {
    const ragingBull = moveToCalcMove(MOVES["raging-bull"])!;
    const kanto = computeDamage(asCalc("tauros"), asCalc("gengar"), ragingBull, { gameType: "Doubles" });
    expect(kanto.immune).toBe(true);
    expect(kanto.verdict.label).toBe("No effect");
    expect(kanto.move.type).toBe("normal");
    // The real Aqua Breed's is Water, and connects.
    const aqua = computeDamage(asCalc("tauros-paldea-aqua-breed"), asCalc("gengar"), ragingBull, { gameType: "Doubles" });
    expect(aqua.move.type).toBe("water");
    expect(aqua.maxDamage).toBeGreaterThan(0);
  });

  it("Castform's Forecast fires from the index: Water in Rain, so Close Combat is neutral (it read 2×)", () => {
    const cc = moveToCalcMove(MOVES["close-combat"])!;
    const castform = asCalc("castform", { ability: "Forecast" });
    const rain = computeDamage(asCalc("machamp"), castform, cc, { gameType: "Doubles", weather: "Rain" });
    const clear = computeDamage(asCalc("machamp"), castform, cc, { gameType: "Doubles" });
    expect(rain.typeEffectiveness).toBe(1);
    expect(clear.typeEffectiveness).toBe(2);
  });
});

describe("calc index — Mega Stones are form data (requiredItem)", () => {
  const pool = new Set((dataset as unknown as { itemPool: string[] }).itemPool);
  const master = (competitive as unknown as { brackets: { master: Record<string, { asForm?: string | null; items?: { displayName: string }[] }> } }).brackets.master;

  it("gives every Mega form its own pool stone — distinct, and the one its ladder sets hold", () => {
    const seen = new Map<string, string>();
    let megas = 0;
    for (const entry of INDEX.entries) {
      for (const form of entry.forms) {
        const key = form.key ?? entry.slug;
        if (!form.isMega) { expect(form.requiredItem, key).toBeNull(); continue; }
        megas++;
        expect(form.requiredItem, key).toBeTruthy();
        expect(pool.has(form.requiredItem!), `${key}: ${form.requiredItem}`).toBe(true);
        expect(seen.get(form.requiredItem!), `${form.requiredItem} claimed twice`).toBeUndefined();
        seen.set(form.requiredItem!, key);
        const own = master[key];
        const held = own && !own.asForm ? own.items?.find((it) => isMegaStone(it.displayName)) : undefined;
        if (held) expect(toID(form.requiredItem!), key).toBe(toID(held.displayName));
      }
    }
    expect(megas).toBeGreaterThanOrEqual(80);
  });

  it("Mega Absol (no Master+ set) needs Absolite; Mega Absol Z needs Absolite Z", () => {
    expect(calcForm("absol-mega").form.preset).toBeNull();
    expect(calcForm("absol-mega").form.requiredItem).toBe("Absolite");
    expect(calcForm("absol-mega-z").form.requiredItem).toBe("Absolite Z");
    expect(calcForm("charizard-mega-y").form.requiredItem).toBe("Charizardite Y");
    expect(calcForm("absol").form.requiredItem).toBeNull();
  });
});

describe("calc index — presets keep every move the calc can compute", () => {
  it("filters through moveToCalcMove: fixed-damage and variable-power moves stay, status moves don't", () => {
    for (const entry of INDEX.entries) {
      for (const form of entry.forms) {
        for (const slug of form.preset?.topMoves ?? []) {
          expect(moveToCalcMove(INDEX.moves[slug] ?? MOVES[slug]), `${form.key ?? entry.slug} ${slug}`).not.toBeNull();
        }
      }
    }
    // Final Gambit (Staraptor, 98%) and Night Shade (Mega Sableye, 70%) were dropped for power: null.
    expect(calcForm("staraptor").form.preset?.topMoves).toContain("final-gambit");
    expect(calcForm("sableye-mega").form.preset?.topMoves).toContain("night-shade");
  });
});

describe("calc index — Stance Change: Aegislash attacks in Blade Forme", () => {
  it("every Aegislash forme carries the Blade forme as attacksAs; nothing else does", () => {
    for (const entry of INDEX.entries) {
      for (const form of entry.forms) {
        if (entry.slug === "aegislash") expect(form.attacksAs?.name, form.key ?? entry.slug).toBe("Aegislash-Blade");
        else expect(form.attacksAs, form.key ?? entry.slug).toBeNull();
      }
    }
  });

  it("Shield selected: Poltergeist into Rillaboom rolls Blade's 144–169, not Shield's 76–91; defending stays Shield", () => {
    const polter = moveToCalcMove(MOVES["poltergeist"])!;
    const { form: shield } = calcForm("aegislash");
    const { form: bladeF } = calcForm("aegislash-blade");
    const rilla = calcForm("rillaboom").form;
    const preset = (f: CalcForm): CalcPokemon => {
      const p = f.preset!;
      const spread = statPointsToSpread(p.nature, p.sp);
      return {
        name: f.battleName, types: f.types, baseStats: f.stats, ability: p.ability, item: p.item,
        nature: p.nature, evs: spread.evs, boosts: {}, status: null, curHpPct: 100, weightKg: f.weightKg,
        attackForm: f.attacksAs ?? undefined,
      };
    };
    const fromShield = computeDamage(preset(shield), preset(rilla), polter, { gameType: "Doubles" });
    const fromBlade = computeDamage(preset(bladeF), preset(rilla), polter, { gameType: "Doubles" });
    expect([fromShield.minDamage, fromShield.maxDamage]).toEqual([144, 169]);
    expect(fromShield.damage).toEqual(fromBlade.damage);
    // Without the stance rule (no attackForm) the Shield forme's 50 Atk would roll 76–91.
    const noStance = computeDamage({ ...preset(shield), attackForm: undefined }, preset(rilla), polter, { gameType: "Doubles" });
    expect([noStance.minDamage, noStance.maxDamage]).toEqual([76, 91]);
    // Defending, the selected forme is used: Shield takes far less than Blade.
    const wood = moveToCalcMove(MOVES["wood-hammer"])!;
    const intoShield = computeDamage(preset(rilla), preset(shield), wood, { gameType: "Doubles" });
    const intoBlade = computeDamage(preset(rilla), preset(bladeF), wood, { gameType: "Doubles" });
    expect(intoShield.maxDamage).toBeLessThan(intoBlade.maxDamage);
  });
});

// ---------------------------------------------------------------------------------
// The reviewers' numbers (iOS de83ba5 review, 2026-11-18), through the calc's
// OWN builder — defaultMon + toCalcPokemon: the form's preset (nature, Stat
// Points, top ability, top item — else its required Mega Stone), full HP.
// ---------------------------------------------------------------------------------
import { effectiveSpeeds, turnOrder, type CalcField } from "./damage";

function webMon(key: string, edits: Partial<CalcPokemon> = {}): CalcPokemon {
  const { form } = calcForm(key);
  const p = form.preset;
  const spread = statPointsToSpread(p?.nature ?? "Hardy", p?.sp ?? {});
  return {
    name: form.battleName, types: form.types, baseStats: form.stats,
    ability: p?.ability ?? form.abilities[0]?.displayName ?? null,
    item: p?.item ?? form.requiredItem, nature: p?.nature ?? "Hardy", evs: spread.evs,
    boosts: {}, status: null, curHpPct: 100, weightKg: form.weightKg,
    attackForm: form.attacksAs ?? undefined, ...edits,
  };
}
const mv = (slug: string) => moveToCalcMove(MOVES[slug])!;
const DOUBLES: CalcField = { gameType: "Doubles" };

describe("survival effects at full HP (Focus Sash, Sturdy, Disguise, Ice Face)", () => {
  it("Kowtow Cleave into full-HP Focus Sash Alakazam: 302–356 into 131 is a guaranteed 2HKO, not '16/16 OHKO'", () => {
    const zam = webMon("alakazam", { item: "Focus Sash" });
    const r = computeDamage(webMon("kingambit"), zam, mv("kowtow-cleave"), DOUBLES);
    expect([r.minDamage, r.maxDamage, r.hp]).toEqual([302, 356, 131]);
    expect(r.verdict).toMatchObject({ label: "2HKO", guaranteed: true, ohkoChance: 0 });
    expect(r.hpAfter).toEqual({ min: 1, max: 1 });
    expect(r.survival?.kind).toBe("focus-sash");
    // Not at full HP, or no Sash: the OHKO is real.
    expect(computeDamage(webMon("kingambit"), { ...zam, curHpPct: 75 }, mv("kowtow-cleave"), DOUBLES).verdict.label).toBe("OHKO");
    expect(computeDamage(webMon("kingambit"), { ...zam, item: null }, mv("kowtow-cleave"), DOUBLES).verdict.ohkoChance).toBe(100);
  });

  it("Sturdy holds the same way, but Mold Breaker ignores it (never the Sash)", () => {
    const zam = webMon("alakazam", { item: null, ability: "Sturdy" });
    const plain = computeDamage(webMon("kingambit"), zam, mv("kowtow-cleave"), DOUBLES);
    expect(plain.verdict.label).toBe("2HKO");
    expect(plain.survival?.kind).toBe("sturdy");
    const breaker = webMon("kingambit", { ability: "Mold Breaker" });
    expect(computeDamage(breaker, zam, mv("kowtow-cleave"), DOUBLES).verdict.label).toBe("OHKO");
    const sash = computeDamage(breaker, { ...zam, ability: "Synchronize", item: "Focus Sash" }, mv("kowtow-cleave"), DOUBLES);
    expect(sash.verdict.label).toBe("2HKO");
  });

  it("a multi-hit move breaks the Sash and finishes with the next hit", () => {
    // Dragon Darts, both darts into a lone Sash target: dart 1 leaves 1 HP, dart 2 KOs.
    const zam = webMon("alakazam", { item: "Focus Sash" });
    const r = computeDamage(webMon("dragapult"), zam, mv("dragon-darts"), { ...DOUBLES, defenderSide: 1 });
    expect(r.hits).toBe(2);
    expect(r.verdict.label).toBe("OHKO");
    expect(r.hpAfter.min).toBe(0);
  });

  it("Disguise: Iron Head into full-HP Mimikyu is blocked (−⅛ = 16 HP) — 2HKO, 0% OHKO (it read 100%)", () => {
    const r = computeDamage(webMon("kingambit"), webMon("mimikyu"), mv("iron-head"), DOUBLES);
    expect([r.minDamage, r.maxDamage, r.hp]).toEqual([186, 218, 130]);
    expect(r.verdict).toMatchObject({ label: "2HKO", guaranteed: true, ohkoChance: 0 });
    expect(r.hpAfter).toEqual({ min: 114, max: 114 });
    expect(r.survival).toEqual({ kind: "disguise", label: "Disguise blocks hit 1 (−16 HP)" });
    // Mold Breaker ignores Disguise; below full HP it is taken as already broken.
    expect(computeDamage(webMon("kingambit", { ability: "Mold Breaker" }), webMon("mimikyu"), mv("iron-head"), DOUBLES).verdict.label).toBe("OHKO");
    expect(computeDamage(webMon("kingambit"), webMon("mimikyu", { curHpPct: 75 }), mv("iron-head"), DOUBLES).survival).toBeNull();
  });

  it("Ice Face blocks the first PHYSICAL hit only, with no HP cost", () => {
    const eiscue = webMon("mimikyu", { ability: "Ice Face" });
    const phys = computeDamage(webMon("kingambit"), eiscue, mv("iron-head"), DOUBLES);
    expect(phys.survival?.kind).toBe("ice-face");
    expect(phys.hpAfter).toEqual({ min: 130, max: 130 });
    expect(phys.verdict.label).toBe("2HKO");
    const spec = computeDamage(webMon("gengar"), eiscue, mv("shadow-ball"), DOUBLES);
    expect(spec.survival).toBeNull();
  });
});

describe("multi-hit KO odds use INDEPENDENT rolls per hit", () => {
  it("Twin Beam into 155-HP Heracross: 78/256 = 30.47% OHKO (pairing roll i with roll i read 50%)", () => {
    const r = computeDamage(webMon("farigiraf"), webMon("heracross"), mv("twin-beam"), DOUBLES);
    expect([r.minDamage, r.maxDamage, r.hp, r.hits]).toEqual([136, 168, 155, 2]);
    expect(r.verdict.ohkoChance).toBeCloseTo((78 / 256) * 100, 10);
    // min–max stays the sum of the hits' mins / maxes.
    expect(r.damage[0]).toBe(136);
    expect(r.damage[15]).toBe(168);
  });

  it("stays exact and fast for 10-hit Population Bomb", () => {
    const t0 = performance.now();
    const r = computeDamage(webMon("maushold"), webMon("incineroar"), mv("population-bomb"), DOUBLES);
    expect(r.hits).toBe(10);
    expect(performance.now() - t0).toBeLessThan(200);
    const sum = r.verdict.koChances.every((p) => p >= 0 && p <= 100);
    expect(sum).toBe(true);
    expect(r.verdict.koChances[1]).toBeGreaterThanOrEqual(r.verdict.koChances[0]);
  });
});

describe("nHKO walks each use with its own changes", () => {
  it("Draco Meteor into 175-HP Araquanid: use 2 at −2 SpA deals 48–58, so it is NOT a guaranteed 2HKO", () => {
    const r = computeDamage(webMon("dragapult"), webMon("araquanid"), mv("draco-meteor"), DOUBLES);
    expect([r.minDamage, r.maxDamage, r.hp]).toEqual([95, 113, 175]);
    expect(r.uses[1]).toEqual({ min: 48, max: 58 });
    expect(r.uses[0].max + r.uses[1].max).toBe(171);
    expect(r.verdict.label).not.toBe("2HKO");
    expect(r.verdict.koChances[1]).toBe(0);
  });

  it("a resist berry only halves the FIRST use", () => {
    const chople = webMon("kingambit", { item: "Chople Berry" });
    const r = computeDamage(webMon("garchomp"), chople, mv("brick-break"), DOUBLES);
    const bare = computeDamage(webMon("garchomp"), { ...chople, item: null }, mv("brick-break"), DOUBLES);
    expect(r.uses[0].max).toBeLessThan(bare.uses[0].max);
    expect(r.uses[1]).toEqual(bare.uses[1]);
  });

  it("Multiscale only guards the first use", () => {
    const nite = webMon("dragonite", { ability: "Multiscale" });
    const r = computeDamage(webMon("froslass"), nite, mv("ice-beam"), DOUBLES);
    expect(r.uses[1].max).toBeGreaterThan(r.uses[0].max * 1.8);
  });
});

describe("Dragon Darts follows the Targets control", () => {
  it("two foes: ONE dart into the selected one; one foe: both darts (Dragapult into Garchomp)", () => {
    const two = computeDamage(webMon("dragapult"), webMon("garchomp"), mv("dragon-darts"), DOUBLES);
    const one = computeDamage(webMon("dragapult"), webMon("garchomp"), mv("dragon-darts"), { ...DOUBLES, defenderSide: 1 });
    expect([two.hits, two.move.targets, two.hp]).toEqual([1, 2, 184]);
    expect([two.minDamage, two.maxDamage]).toEqual([86, 101]);
    expect(two.verdict.label).toBe("2HKO–3HKO");
    expect([one.hits, one.move.targets]).toEqual([2, 1]);
    expect([one.minDamage, one.maxDamage]).toEqual([172, 202]);
  });
});

describe("Gale Wings' +1 reaches the priority blockers", () => {
  it("full-HP Talonflame's Brave Bird fails into Armor Tail Farigiraf and into Psychic Terrain", () => {
    const bird = webMon("talonflame");
    expect(bird.ability).toBe("Gale Wings");
    const r = computeDamage(bird, webMon("farigiraf"), mv("brave-bird"), DOUBLES);
    expect(r.fails).toBe("Armor Tail blocks priority");
    expect(r.move.priority).toBe(1);
    const psychic = computeDamage(bird, webMon("rillaboom"), mv("brave-bird"), { ...DOUBLES, terrain: "Psychic" });
    expect(psychic.fails).toBe("Psychic Terrain blocks priority");
    // Below full HP there is no +1: it connects.
    const hurt = computeDamage({ ...bird, curHpPct: 75 }, webMon("farigiraf"), mv("brave-bird"), DOUBLES);
    expect(hurt.fails).toBeNull();
    expect(hurt.move.priority).toBe(0);
  });
});

describe("spread targets come from each direction's TARGET side", () => {
  it("Rock Slide: into a two-mon side ×0.75, into a lone mon full power", () => {
    const g = webMon("garchomp");
    const t = webMon("tyranitar");
    const rs = mv("rock-slide");
    // Garchomp is alone on its side; Tyranitar has a partner.
    const fwd = computeDamage(g, t, rs, { ...DOUBLES, attackerSide: 1, defenderSide: 2 });
    const back = computeDamage(t, g, rs, { ...DOUBLES, attackerSide: 2, defenderSide: 1 });
    expect([fwd.minDamage, fwd.maxDamage, fwd.move.spread]).toEqual([33, 39, true]);
    expect([back.minDamage, back.maxDamage, back.move.spread]).toEqual([34, 41, false]);
  });

  it("Earthquake still spreads into a lone foe when the user's own ally is out", () => {
    const eq = mv("earthquake");
    const withAlly = computeDamage(webMon("garchomp"), webMon("incineroar"), eq, { ...DOUBLES, attackerSide: 2, defenderSide: 1 });
    const alone = computeDamage(webMon("garchomp"), webMon("incineroar"), eq, { ...DOUBLES, attackerSide: 1, defenderSide: 1 });
    expect([withAlly.move.targets, withAlly.move.spread]).toEqual([2, true]);
    expect([alone.move.targets, alone.move.spread]).toEqual([1, false]);
  });
});

describe("resolved move facts", () => {
  it("Weather Ball in Sun is Fire / 100; airborne Expanding Force in Psychic Terrain is not spread", () => {
    const wb = computeDamage(webMon("charizard-mega-y"), webMon("rillaboom"), mv("weather-ball"), { ...DOUBLES, weather: "Sun" });
    expect(wb.move).toMatchObject({ type: "fire", basePower: 100, spread: false, hits: 1 });
    const plain = computeDamage(webMon("charizard-mega-y"), webMon("rillaboom"), mv("weather-ball"), DOUBLES);
    expect(plain.move).toMatchObject({ type: "normal", basePower: 50 });
    const psychic: CalcField = { ...DOUBLES, terrain: "Psychic" };
    const floating = computeDamage(webMon("alakazam", { item: "Air Balloon" }), webMon("rillaboom"), mv("expanding-force"), psychic);
    expect(floating.move).toMatchObject({ spread: false, targets: 1 });
    const grounded = computeDamage(webMon("alakazam", { item: null }), webMon("rillaboom"), mv("expanding-force"), psychic);
    expect(grounded.move).toMatchObject({ spread: true, targets: 2 });
  });
});

describe("turn order compares EFFECTIVE speed and priority", () => {
  it("Choice Scarf Garchomp (231) outspeeds Dragapult (213) — the header said Dragapult first", () => {
    const g = webMon("garchomp", { item: "Choice Scarf" });
    const d = webMon("dragapult", { item: "Life Orb" });
    const s = effectiveSpeeds(g, d, DOUBLES);
    expect(s).toEqual({ a: 231, b: 213 });
    expect(turnOrder({ speed: s.a, priority: 0 }, { speed: s.b, priority: 0 })).toBe("a");
    expect(turnOrder({ speed: s.a, priority: 0 }, { speed: s.b, priority: 0 }, true)).toBe("b");
    expect(turnOrder({ speed: s.a, priority: 0 }, { speed: s.b, priority: 1 })).toBe("b");
    // Tailwind doubles; paralysis halves after the chain.
    expect(effectiveSpeeds(g, d, { ...DOUBLES, defenderTailwind: true }).b).toBe(426);
    expect(effectiveSpeeds({ ...g, status: "par" }, d, DOUBLES).a).toBe(115);
  });
});
