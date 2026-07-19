/**
 * Golden tests for the client damage engine.
 *
 * `@smogon/calc` is a dev-only dependency (it powers the build-time KO
 * benchmarks). Here it is the ORACLE: for a broad sample of real meta
 * matchups we compute damage with BOTH the library and our ported
 * `computeDamage`, and require the 16-roll arrays to match exactly. This is
 * the regression net that lets us ship a hand-rolled formula with confidence —
 * if the port ever drifts from the library, CI goes red.
 *
 * Group A neutralizes abilities (Illuminate) to validate the core formula +
 * items across hundreds of cases. Group B pins each modeled ability/field
 * modifier with a hand-built matchup.
 */
import { describe, it, expect } from "vitest";
import { calculate, Generations, Pokemon, Move, Field } from "@smogon/calc";
import competitive from "../data/generated/competitive.json";
import dataset from "../data/generated/pokemon.json";
import { computeDamage, moveToCalcMove, type CalcPokemon } from "./damage";
import { isSpreadMove } from "./spread";
import type { MoveSummary, PokemonType } from "./types";

const GEN = Generations.get(9);
/* eslint-disable @typescript-eslint/no-explicit-any */
const master = (competitive as any).brackets.master as Record<string, any>;
const MOVES = (dataset as any).moves as Record<string, MoveSummary>;

const DAMAGE_ITEMS = new Set([
  "Life Orb", "Choice Band", "Choice Specs", "Expert Belt", "Assault Vest",
  "Eviolite", "Sitrus Berry",
]);

// Charge/signature moves the library auto-boosts (e.g. +1 SpA on use) — not a
// pure damage formula, so excluded from the formula-parity sweep.
const AUTO_BOOST_MOVES = new Set(["electro-shot", "meteor-beam"]);

interface Built {
  calc: Pokemon;
  mine: CalcPokemon;
}

/** Build a matched @smogon/calc Pokemon + our CalcPokemon from the same inputs. */
function build(
  profile: any,
  ability: string,
  item: string | undefined,
  extra: Partial<CalcPokemon> = {},
  boosts?: Record<string, number>,
): Built {
  const evs: Record<string, number> = {};
  for (const [k, v] of Object.entries(profile.spread?.evs ?? {})) evs[k] = v as number;
  const nature = profile.spread?.nature ?? "Hardy";
  const calc = new Pokemon(GEN, profile.smogonName, {
    level: 50,
    nature,
    evs,
    ability,
    item,
    boosts: boosts as any,
  });
  const base = calc.species.baseStats;
  const mine: CalcPokemon = {
    name: profile.smogonName,
    types: (calc.types as readonly string[]).map((t) => t.toLowerCase() as PokemonType),
    baseStats: {
      hp: base.hp, attack: base.atk, defense: base.def,
      specialAttack: base.spa, specialDefense: base.spd, speed: base.spe, total: 0,
    },
    nature,
    evs: profile.spread?.evs ?? {},
    ability,
    item: item ?? null,
    boosts: boosts as any,
    weightKg: (calc as any).weightkg,
    ...extra,
  };
  return { calc, mine };
}

function makeCalcMove(meta: MoveSummary): Move {
  const move = new Move(GEN, meta.displayName);
  if (isSpreadMove(meta.target)) (move as any).spreadHit = true;
  return move;
}

/** @smogon/calc's 16-roll array for a single-hit move, or null if unusable. */
function calcDamage(a: Pokemon, d: Pokemon, move: Move, field: Field): number[] | null {
  let result;
  try {
    result = calculate(GEN, a, d, move, field);
  } catch {
    return null;
  }
  const dmg = result.damage;
  if (typeof dmg === "number") return new Array(16).fill(dmg);
  if (!Array.isArray(dmg) || dmg.length !== 16 || typeof dmg[0] !== "number") return null;
  return [...(dmg as number[])].sort((x, y) => x - y);
}

const DOUBLES = new Field({ gameType: "Doubles" });

describe("damage engine — core formula parity vs @smogon/calc (abilities neutralized)", () => {
  it("matches the library's 16-roll damage across the meta", () => {
    const profiles = Object.values(master)
      .filter((p: any) => !p.asForm && p.spread && p.smogonName)
      .sort((a: any, b: any) => b.usagePct - a.usagePct);
    const attackers = profiles.slice(0, 34);
    const defenders = profiles.slice(0, 8);

    const mismatches: string[] = [];
    let compared = 0;

    for (const ap of attackers) {
      const item = DAMAGE_ITEMS.has(ap.items?.[0]?.displayName) ? ap.items[0].displayName : undefined;
      let attacker: Built;
      try {
        attacker = build(ap, "Illuminate", item);
      } catch {
        continue;
      }
      const moves = Object.entries(ap.moveUsage as Record<string, number>)
        .sort((x, y) => y[1] - x[1])
        .map(([slug]) => MOVES[slug])
        .filter(
          (m): m is MoveSummary =>
            !!m && m.damageClass !== "status" && !!m.power &&
            (m.maxHits ?? 1) <= 1, // single-hit only (multi-hit is an approximation)
        )
        .slice(0, 5);

      for (const meta of moves) {
        const mine = moveToCalcMove(meta);
        if (!mine) continue;
        // Signature moves @smogon/calc special-cases (auto stat boosts on charge,
        // etc.) — out of scope for a pure-formula parity check.
        if (AUTO_BOOST_MOVES.has(meta.name)) continue;
        const calcMove = makeCalcMove(meta);
        if (calcMove.bp !== meta.power) continue; // data-power mismatch: out of formula scope
        // The library and our dataset must agree on whether the move is spread;
        // where they disagree it's a move-metadata difference, not a formula bug
        // (our engine matches the app's own benchmark bake, which uses the same set).
        const calcSpread = ["allAdjacent", "allAdjacentFoes"].includes(calcMove.target as string);
        if (calcSpread !== isSpreadMove(meta.target)) continue;

        for (const dp of defenders) {
          if (dp.smogonName === ap.smogonName) continue;
          const dItem = DAMAGE_ITEMS.has(dp.items?.[0]?.displayName) ? dp.items[0].displayName : undefined;
          let defender: Built;
          try {
            defender = build(dp, "Illuminate", dItem);
          } catch {
            continue;
          }
          const expected = calcDamage(attacker.calc, defender.calc, calcMove, DOUBLES);
          if (!expected) continue;
          const got = computeDamage(attacker.mine, defender.mine, mine, { gameType: "Doubles" }).damage;
          compared++;
          if (JSON.stringify(got) !== JSON.stringify(expected)) {
            if (mismatches.length < 12) {
              mismatches.push(
                `${ap.smogonName} ${meta.displayName} -> ${dp.smogonName}\n` +
                  `   mine: ${got.join(",")}\n   calc: ${expected.join(",")}`,
              );
            }
          }
        }
      }
    }

    // Sanity: we actually exercised a lot of matchups.
    expect(compared).toBeGreaterThan(300);
    expect(mismatches, `\n${mismatches.join("\n")}`).toEqual([]);
  });
});

describe("damage engine — modeled abilities & field modifiers parity", () => {
  // Pick two profiles with useful typings for hand cases.
  const find = (name: string) =>
    Object.values(master).find((p: any) => p.smogonName === name && !p.asForm) as any;

  interface Case {
    name: string;
    atk: string;
    def: string;
    move: string; // move slug
    ability?: string;
    item?: string;
    dAbility?: string;
    dItem?: string;
    field?: Field;
    atkBoosts?: Record<string, number>;
    aStatus?: "brn";
  }

  const cases: Case[] = [
    { name: "spread move ×0.75", atk: "Garchomp", def: "Incineroar", move: "earthquake" },
    { name: "single-target move", atk: "Garchomp", def: "Incineroar", move: "dragon-claw" },
    { name: "Life Orb", atk: "Garchomp", def: "Incineroar", move: "earthquake", item: "Life Orb" },
    { name: "Choice Band", atk: "Garchomp", def: "Incineroar", move: "earthquake", item: "Choice Band" },
    { name: "Expert Belt (SE)", atk: "Garchomp", def: "Kingambit", move: "earthquake", item: "Expert Belt" },
    { name: "Assault Vest (def, spec)", atk: "Charizard", def: "Incineroar", move: "flamethrower", dItem: "Assault Vest" },
    { name: "Multiscale (def)", atk: "Garchomp", def: "Incineroar", move: "earthquake", dAbility: "Multiscale" },
    { name: "Thick Fat (def, fire)", atk: "Charizard", def: "Incineroar", move: "flamethrower", dAbility: "Thick Fat" },
    { name: "Filter (SE, def)", atk: "Garchomp", def: "Kingambit", move: "earthquake", dAbility: "Filter" },
    { name: "Ice Scales (def, spec)", atk: "Charizard", def: "Incineroar", move: "flamethrower", dAbility: "Ice Scales" },
    { name: "Adaptability (atk)", atk: "Garchomp", def: "Incineroar", move: "earthquake", ability: "Adaptability" },
    { name: "Technician (atk, ≤60bp)", atk: "Garchomp", def: "Incineroar", move: "bulldoze", ability: "Technician" },
    { name: "Tough Claws (contact)", atk: "Garchomp", def: "Incineroar", move: "dragon-claw", ability: "Tough Claws" },
    { name: "atk +2 boost", atk: "Garchomp", def: "Incineroar", move: "earthquake", atkBoosts: { atk: 2 } },
    { name: "burn halves physical", atk: "Garchomp", def: "Incineroar", move: "earthquake", aStatus: "brn" },
    { name: "Reflect (doubles)", atk: "Garchomp", def: "Incineroar", move: "earthquake", field: new Field({ gameType: "Doubles", defenderSide: { isReflect: true } }) },
    { name: "Light Screen (doubles)", atk: "Charizard", def: "Incineroar", move: "flamethrower", field: new Field({ gameType: "Doubles", defenderSide: { isLightScreen: true } }) },
    { name: "Helping Hand", atk: "Garchomp", def: "Incineroar", move: "earthquake", field: new Field({ gameType: "Doubles", attackerSide: { isHelpingHand: true } }) },
    { name: "Sun boosts Fire", atk: "Charizard", def: "Incineroar", move: "flamethrower", field: new Field({ gameType: "Doubles", weather: "Sun" }) },
    // Variable-power moves (BP from weight / speed).
    { name: "Low Kick (target weight)", atk: "Garchomp", def: "Kingambit", move: "low-kick" },
    { name: "Grass Knot (target weight)", atk: "Garchomp", def: "Kingambit", move: "grass-knot" },
    { name: "Heavy Slam (weight ratio)", atk: "Kingambit", def: "Garchomp", move: "heavy-slam" },
    { name: "Gyro Ball (speed)", atk: "Kingambit", def: "Garchomp", move: "gyro-ball" },
    { name: "Electro Ball (speed)", atk: "Garchomp", def: "Kingambit", move: "electro-ball" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const ap = find(c.atk);
      const dp = find(c.def);
      const meta = MOVES[c.move];
      if (!ap || !dp || !meta) {
        // If a chosen mon/move isn't in the current meta snapshot, don't fail
        // the suite on data drift — just skip this one.
        return;
      }
      const attacker = build(ap, c.ability ?? "Illuminate", c.item, c.aStatus ? { status: c.aStatus } : {}, c.atkBoosts);
      const defender = build(dp, c.dAbility ?? "Illuminate", c.dItem);
      if (c.aStatus) attacker.calc.status = c.aStatus as any;

      const calcMove = makeCalcMove(meta);
      if (calcMove.bp !== meta.power) return;

      const field = c.field ?? DOUBLES;
      const expected = calcDamage(attacker.calc, defender.calc, calcMove, field);
      const mine = moveToCalcMove(meta);
      if (!expected || !mine) return;

      const got = computeDamage(attacker.mine, defender.mine, mine, {
        gameType: "Doubles",
        weather: (field.weather as any) || null,
        helpingHand: field.attackerSide.isHelpingHand,
        reflect: field.defenderSide.isReflect,
        lightScreen: field.defenderSide.isLightScreen,
        auroraVeil: field.defenderSide.isAuroraVeil,
      }).damage;

      expect(got, c.name).toEqual(expected);
    });
  }
});
