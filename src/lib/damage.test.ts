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
 * items across hundreds of cases. Group C is its mirror image: every top ladder
 * set with its REAL ability, item and spread, into the top defenders with
 * theirs — and again with each of their other abilities. Group B pins each
 * modeled ability / item / move / field modifier with a hand-built matchup, and
 * the whole-index suites hold every name-keyed move table to the library.
 * Champions-original abilities have no library entry: each is pinned against the
 * library ability Showdown's champions mod implements it identically to
 * (`championsProxy`).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { calculate, Generations, Pokemon, Move, Field } from "@smogon/calc";
import competitive from "../data/generated/competitive.json";
import dataset from "../data/generated/pokemon.json";
import {
  alwaysCrits, computeDamage, hasSecondaryEffect, ignoresDefenseStages, isMegaStone, isRecklessMove,
  moveToCalcMove, selfAttackDrop, type CalcField, type CalcPokemon, type Terrain, type Weather,
} from "./damage";
import { isSpreadMove } from "./spread";
import { TYPE_CHART } from "./type-chart";
import type { MoveSummary, PokemonType } from "./types";

const GEN = Generations.get(9);
/* eslint-disable @typescript-eslint/no-explicit-any */
const master = (competitive as any).brackets.master as Record<string, any>;
const MOVES = (dataset as any).moves as Record<string, MoveSummary>;

const DAMAGE_ITEMS = new Set([
  "Life Orb", "Choice Band", "Choice Specs", "Expert Belt", "Assault Vest",
  "Eviolite", "Sitrus Berry",
]);

const toID = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const pokeRound = (n: number): number => (n % 1 > 0.5 ? Math.ceil(n) : Math.floor(n));

/**
 * The library's own spelling of an ability / item. It compares names EXACTLY,
 * and the baked data carried slug-rule spellings until 2026-11-18 ("Good As
 * Gold", "Never Melt Ice", "Kings Rock" — official since, see names.test.ts):
 * passed through raw, the library silently ignores the ability or item — and a
 * parity pin then passes for the wrong reason. Kept as the guard.
 */
const libAbilityName = (n: string): string => (GEN.abilities.get(toID(n) as any)?.name as string | undefined) ?? n;
const libItemName = (n: string | undefined): string | undefined =>
  n && ((GEN.items.get(toID(n) as any)?.name as string | undefined) ?? n);

interface Built {
  calc: Pokemon;
  mine: CalcPokemon;
}

interface BuildOpts {
  /** The ability the LIBRARY gets when it can't take ours (a Champions-original's stand-in). */
  libAbility?: string;
  /** `abilityOn` for that stand-in (Fire Mane → an ACTIVATED Flash Fire). */
  abilityOn?: boolean;
  /** Current HP %, for both engines (Blaze & co., Eruption, Flail, Hard Press, Multiscale). */
  hpPct?: number;
}

/** Build a matched @smogon/calc Pokemon + our CalcPokemon from the same inputs. */
function build(
  profile: any,
  ability: string,
  item: string | undefined,
  extra: Partial<CalcPokemon> = {},
  boosts?: Record<string, number>,
  opts: BuildOpts = {},
): Built {
  const evs: Record<string, number> = {};
  for (const [k, v] of Object.entries(profile.spread?.evs ?? {})) evs[k] = v as number;
  const nature = profile.spread?.nature ?? "Hardy";
  const make = (curHP?: number) =>
    new Pokemon(GEN, profile.smogonName, {
      level: 50,
      nature,
      evs,
      ability: libAbilityName(opts.libAbility ?? ability) as any,
      item: libItemName(item) as any,
      boosts: boosts as any,
      abilityOn: opts.abilityOn,
      // Genderless, so Rivalry stays neutral: the calc takes no genders, and
      // the library would otherwise read both sides as male (a silent +25%).
      gender: "N",
      curHP,
    });
  let calc = make();
  if (opts.hpPct != null && opts.hpPct < 100) {
    calc = make(Math.max(1, Math.floor((calc.rawStats.hp * opts.hpPct) / 100)));
  }
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
    curHpPct: opts.hpPct,
    ...extra,
  };
  return { calc, mine };
}

/**
 * The library ships MAINLINE move data; the baked index carries Champions'
 * (Showdown's champions-mod patches: Grav Apple 90 BP, First Impression 100,
 * Snap Trap Steel, Double Shock a punch, Dragon Claw slicing…). This suite
 * tests the damage FORMULA, so both engines must get the same move: our power,
 * type, category and flags go into the library's Move. Without this a patched
 * move silently drops out of the sweep (the `bp !== meta.power` skip) — First
 * Impression, Mega Golisopod's 76% STAB, would go untested. Kept in step with
 * `championsMoveOverrides` in scripts/generate-competitive.mjs (the benchmarks).
 */
const CALC_FLAG_KEYS = ["contact", "punch", "sound", "bullet", "bite", "slicing", "wind", "pulse"] as const;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function championsMoveOverrides(meta: MoveSummary) {
  return {
    ...(meta.power ? { basePower: meta.power } : {}),
    type: capitalize(meta.type),
    category: capitalize(meta.damageClass),
    flags: Object.fromEntries(CALC_FLAG_KEYS.map((k) => [k, meta.flags?.includes(k) ? 1 : 0])),
  } as any;
}

function makeCalcMove(meta: MoveSummary, options: { isCrit?: boolean; ability?: string; overrides?: Record<string, unknown> } = {}): Move {
  // No `spreadHit` flag here: @smogon/calc has no such property — it derives the
  // ×0.75 from its OWN move target plus the field's gameType. Setting one was a
  // silent no-op (verified: identical 16-roll arrays with and without it).
  // `ability` matters to the Move itself: Skill Link sets the hit count there.
  const { overrides, ...rest } = options;
  return new Move(GEN, meta.displayName, {
    ...rest,
    ability: rest.ability as any,
    overrides: { ...championsMoveOverrides(meta), ...overrides },
  });
}

/**
 * @smogon/calc's damage as ONE 16-roll array, or null if unusable. Multi-hit
 * moves and Parental Bond come back as one array per hit — folded into the
 * per-roll sum, exactly how `computeDamage` folds them; fixed damage
 * (Seismic Toss) comes back as a number, or [50, 50] with Parental Bond.
 */
function calcDamage(a: Pokemon, d: Pokemon, move: Move, field: Field): number[] | null {
  let result;
  try {
    result = calculate(GEN, a, d, move, field);
  } catch {
    return null;
  }
  const dmg = result.damage as unknown;
  if (typeof dmg === "number") return new Array(16).fill(dmg);
  if (!Array.isArray(dmg) || dmg.length === 0) return null;
  if (Array.isArray(dmg[0])) {
    const hits = dmg as number[][];
    if (hits.some((h) => !Array.isArray(h) || h.length !== 16)) return null;
    const sorted = hits.map((h) => [...h].sort((x, y) => x - y));
    return sorted[0].map((_, i) => sorted.reduce((sum, h) => sum + h[i], 0));
  }
  const flat = dmg as number[];
  if (typeof flat[0] !== "number") return null;
  if (flat.length < 16) return new Array(16).fill(flat.reduce((sum, x) => sum + x, 0));
  if (flat.length !== 16) return null;
  return [...flat].sort((x, y) => x - y);
}

/**
 * Spicy Spray (Mega Scovillain) burns the attacker after EVERY hit — Showdown's
 * `onDamagingHit → source.trySetStatus('brn')` — which no single library run can
 * express, so its oracle is the library's own per-hit rolls: hit 1 from the run
 * as given, every later hit from a second run with the attacker burned (or, when
 * a Lum / Rawst Berry cures it before the next hit, with the berry spent). Who
 * can be burned is kept in step with damage.ts `betweenHits`: not a Fire type, no
 * status already, no burn-proof ability, not Leaf Guard in Sun, not grounded in
 * Misty Terrain. Single hits (and burn-proof attackers) are the plain run.
 */
function spicySprayExpected(a: Built, d: Built, move: Move, field: Field): number[] | null {
  const plain = calcDamage(a.calc, d.calc, move, field);
  const hitsOf = (atk: Pokemon): number[][] | null => {
    try {
      const dmg = calculate(GEN, atk, d.calc, move, field).damage as unknown;
      return Array.isArray(dmg) && Array.isArray(dmg[0]) ? (dmg as number[][]).map((h) => [...h].sort((x, y) => x - y)) : null;
    } catch {
      return null;
    }
  };
  const first = hitsOf(a.calc);
  const m = a.mine;
  const ab = toID(m.ability ?? "");
  const grounded = has(m.item, "ironball") ||
    (!m.types.includes("flying") && !["levitate", "eelevate"].includes(ab) && !has(m.item, "airballoon"));
  const burnable = !m.status && !m.types.includes("fire") &&
    !["waterveil", "waterbubble", "thermalexchange", "purifyingsalt", "comatose"].includes(ab) &&
    !(ab === "leafguard" && field.weather === "Sun") && !(field.terrain === "Misty" && grounded);
  if (!first || first.length < 2 || !burnable) return plain;
  const later = a.calc.clone();
  if (has(m.item, "lumberry", "rawstberry")) later.item = undefined;
  else later.status = "brn";
  const rest = hitsOf(later);
  if (!rest) return null;
  const hits = [first[0], ...rest.slice(1)];
  return hits[0].map((_, i) => hits.reduce((sum, h) => sum + h[i], 0));
}
const has = (item: string | null | undefined, ...ids: string[]) => !!item && ids.includes(toID(item));

const DOUBLES = new Field({ gameType: "Doubles" });

/** The sweeps run thousands of library calcs: give a loaded CI runner room (vitest's default is 5 s). */
const SWEEP_TIMEOUT = 60_000;

/**
 * INTENDED DIVERGENCE (2026-11-18): Dragon Darts fires one dart per foe — with
 * two foes out the selected one takes ONE dart, a lone foe takes both. The
 * library always rolls 2 darts into the target, i.e. the engine's ONE-foe case,
 * so every parity comparison of Dragon Darts runs the engine with
 * `defenderSide: 1` (the two-foe case is pinned engine-only below).
 */
const libraryTargets = (moveName: string): CalcField =>
  toID(moveName) === "dragondarts" ? { defenderSide: 1 } : {};

/** Our CalcField for a library Field (same switches, our spelling). */
function fieldOf(field: Field, isCritical?: boolean, moveName = ""): CalcField {
  return {
    ...libraryTargets(moveName),
    gameType: "Doubles",
    weather: (field.weather as Weather) || null,
    terrain: (field.terrain as Terrain) || null,
    helpingHand: field.attackerSide.isHelpingHand,
    reflect: field.defenderSide.isReflect,
    lightScreen: field.defenderSide.isLightScreen,
    auroraVeil: field.defenderSide.isAuroraVeil,
    friendGuard: field.defenderSide.isFriendGuard,
    isCritical,
  };
}

/** Moves an -ate ability never retypes (the library's / Showdown's no-type-change list). */
const NO_ATE = new Set([
  "judgment", "multi-attack", "natural-gift", "nature-power", "revelation-dance",
  "struggle", "techno-blast", "terrain-pulse", "weather-ball",
]);

/**
 * @smogon/calc has never heard of Champions' own abilities. Each is pinned
 * against the library ability Showdown's champions mod implements it
 * IDENTICALLY to (pinned commit — data/abilities.ts, sim/pokemon.ts):
 *  - Fire Mane (Mega Pyroar): `onModifyAtk/SpA` priority 5, ×1.5 on Fire — the
 *    shape of the library's ACTIVATED Flash Fire (6144, same attack chain).
 *    Attacker side only; it does nothing defensively.
 *  - Eelevate (Mega Eelektross): `isGrounded` reads hasAbility(['levitate',
 *    'eelevate']) and both are breakable → Levitate, both sides.
 *  - Aura Guard (Mega Lucario Z): `onSourceModifyDamage`, contact → ×0.5,
 *    breakable → Fluffy's contact half. A FIRE contact move would also meet
 *    Fluffy's ×2, so there Multiscale (full HP) stands in: the adjacent rung of
 *    the same final chain, the same 2048, the same Mold Breaker break.
 *  - Mega Sol (Mega Meganium): its moves see Sun (`effectiveWeather`) → the
 *    library with Sun on the field, whatever the real weather.
 *  - Dragonize (Mega Feraligatr): Pixilate's code with Dragon → the move
 *    pre-typed Dragon at pokeRound(bp × 4915/4096) — exact while no other BP
 *    modifier is in play (true of every pin and sweep case that uses it).
 *  - Piercing Drill: changes no damage roll (Protect isn't modelled) → a no-op.
 *  - Spicy Spray: a no-op for the hit it reacts to (the burn lands after it) —
 *    but a multi-hit / Parental Bond user takes its LATER hits burned, so
 *    `runBoth` oracles it with `spicySprayExpected` (the library's own rolls,
 *    burned from hit 2).
 */
interface Proxy {
  ability: string;
  abilityOn?: boolean;
  weather?: "Sun";
  move?: Record<string, unknown>;
}
function championsProxy(ability: string, role: "attacker" | "defender", meta: MoveSummary): Proxy | null {
  switch (toID(ability)) {
    case "firemane":
      return role === "attacker" ? { ability: "Flash Fire", abilityOn: true } : { ability: "Illuminate" };
    case "eelevate":
      return { ability: "Levitate" };
    case "auraguard":
      if (role === "attacker" || !meta.flags?.includes("contact")) return { ability: "Illuminate" };
      return { ability: meta.type === "fire" ? "Multiscale" : "Fluffy" };
    case "megasol":
      return role === "attacker" ? { ability: "Illuminate", weather: "Sun" } : { ability: "Illuminate" };
    case "dragonize":
      if (role === "defender" || meta.type !== "normal" || NO_ATE.has(meta.name) || !meta.power) {
        return { ability: "Illuminate" };
      }
      return { ability: "Illuminate", move: { type: "Dragon", basePower: pokeRound((meta.power * 4915) / 4096) } };
    case "piercingdrill":
    case "spicyspray":
      return { ability: "Illuminate" };
    default:
      return null;
  }
}

interface SideSpec {
  profile: any;
  ability: string;
  item?: string;
  boosts?: Record<string, number>;
  status?: "brn" | "par" | "psn" | "tox" | "slp";
  hpPct?: number;
  /** Hand-picked library stand-in (overrides `championsProxy`). */
  libAbility?: string;
}

interface Pair {
  expected: number[] | null;
  got: number[];
  /** The bp the library's move should carry — a mismatch means its data differs (out of formula scope). */
  bpOk: boolean;
  libraryKnows: boolean;
}

/** Run one matchup through BOTH engines from the same inputs. */
function runBoth(a: SideSpec, d: SideSpec, meta: MoveSummary, field: Field = DOUBLES, opts: { crit?: boolean; libMove?: Record<string, unknown> } = {}): Pair | null {
  const mine = moveToCalcMove(meta);
  if (!mine) return null;
  const aProxy = a.libAbility ? { ability: a.libAbility } : championsProxy(a.ability, "attacker", meta);
  const dProxy = d.libAbility ? { ability: d.libAbility } : championsProxy(d.ability, "defender", meta);
  const attacker = build(a.profile, a.ability, a.item, a.status ? { status: a.status } : {}, a.boosts, {
    libAbility: aProxy?.ability, abilityOn: (aProxy as Proxy | null)?.abilityOn, hpPct: a.hpPct,
  });
  const defender = build(d.profile, d.ability, d.item, d.status ? { status: d.status } : {}, d.boosts, {
    libAbility: dProxy?.ability, hpPct: d.hpPct,
  });
  if (a.status) attacker.calc.status = a.status as any;
  if (d.status) defender.calc.status = d.status as any;
  const overrides = { ...(aProxy as Proxy | null)?.move, ...opts.libMove };
  const calcMove = makeCalcMove(meta, { isCrit: opts.crit, ability: attacker.calc.ability, overrides });
  const wantBp = (overrides.basePower as number | undefined) ?? meta.power ?? 0;
  let libField = field;
  if ((aProxy as Proxy | null)?.weather) {
    libField = field.clone();
    libField.weather = "Sun";
  }
  const libraryKnows = [attacker.calc.ability, defender.calc.ability].every((n) => !!n && !!GEN.abilities.get(toID(n) as any));
  return {
    expected: toID(d.ability) === "spicyspray"
      ? spicySprayExpected(attacker, defender, calcMove, libField)
      : calcDamage(attacker.calc, defender.calc, calcMove, libField),
    got: computeDamage(attacker.mine, defender.mine, mine, fieldOf(field, opts.crit, meta.name)).damage,
    bpOk: calcMove.bp === wantBp,
    libraryKnows,
  };
}

/** A master-bracket profile by Smogon name — or a bare stand-in for species with no ladder data. */
const find = (name: string): any =>
  Object.values(master).find((p: any) => p.smogonName === name && !p.asForm) ??
  { smogonName: name, spread: { nature: "Hardy", evs: {} } };

describe("damage engine — core formula parity vs @smogon/calc (abilities neutralized)", () => {
  it("matches the library's 16-roll damage across the meta", () => {
    const profiles = Object.values(master)
      .filter((p: any) => !p.asForm && p.spread && p.smogonName)
      .sort((a: any, b: any) => b.usagePct - a.usagePct);
    const attackers = profiles.slice(0, 34);
    const defenders = profiles.slice(0, 8);

    const mismatches: string[] = [];
    const targetDrift: string[] = [];
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
        // (Meteor Beam / Electro Shot used to be skipped here: the library adds
        // the charge turn's +1 SpA and the engine didn't. It does now.)
        const calcMove = makeCalcMove(meta);
        if (calcMove.bp !== meta.power) continue; // data-power mismatch: out of formula scope
        // The library and our dataset must agree on whether the move is spread.
        // This used to `continue` past a disagreement, which is exactly how
        // Matcha Gotcha shipped mis-targeted (and 33% overstated) — so it is now
        // a recorded failure. Exhaustive coverage lives in the spread suite below.
        const calcSpread = ["allAdjacent", "allAdjacentFoes"].includes(calcMove.target as string);
        if (calcSpread !== isSpreadMove(meta.target)) {
          targetDrift.push(`${meta.name}: ours=${meta.target} calc=${calcMove.target}`);
          continue;
        }

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
    expect(targetDrift, `\nspread-target drift:\n${targetDrift.join("\n")}`).toEqual([]);
    expect(mismatches, `\n${mismatches.join("\n")}`).toEqual([]);
  }, SWEEP_TIMEOUT);
});

describe("damage engine — abilities ON: real ladder sets vs @smogon/calc (Group C)", () => {
  // Group A neutralizes every ability, so an ability the engine doesn't port is
  // invisible there — Pixilate/Aerilate Hyper Voice read Normal (a Ghost walled
  // it), Fairy Aura, Armor Tail, Soundproof, Liquid Voice, type-boosting items…
  // This is its mirror image: each top Master+ set with its REAL top ability,
  // top item and ladder spread, using its top damaging moves (multi-hit,
  // variable-power and fixed-damage ones included — the engine folds hits the
  // way the library does), into the top defenders with THEIR real ability and
  // item — then once more with each of the defender's other abilities.
  //
  // State the calc has no input for is left where the library defaults it:
  // `abilityOn` off (Intimidate, Flash Fire's boost, Plus/Minus, Stakeout,
  // Unburden), no fainted allies (Supreme Overlord, Last Respects), genderless
  // (Rivalry), full HP, no boosts, neutral field. Everything else must match.
  const ABILITY_DISPLAY = new Map<string, string>();
  const FORM_ABILITIES = new Map<string, string[]>();
  for (const p of (dataset as any).pokemon) {
    for (const f of [p, ...(p.forms ?? [])]) {
      const names = (f.abilities ?? []).map((a: any) => a.displayName as string);
      FORM_ABILITIES.set(f.key ?? p.name, names);
      for (const a of f.abilities ?? []) ABILITY_DISPLAY.set(toID(a.name), a.displayName);
    }
  }
  const topAbility = (p: any): string | null => {
    const best = Object.entries((p.abilityUsage ?? {}) as Record<string, number>).sort((x, y) => y[1] - x[1])[0];
    if (!best) return null;
    return ABILITY_DISPLAY.get(best[0]) ?? (GEN.abilities.get(best[0] as any)?.name as string | undefined) ?? null;
  };

  it("matches the library with every top set's real ability, item and spread", () => {
    const entries = (Object.entries(master) as [string, any][])
      .filter(([, p]) => !p.asForm && p.spread && p.smogonName)
      .sort((a, b) => b[1].usagePct - a[1].usagePct);
    const attackers = entries.slice(0, 60);
    const defenders = entries.slice(0, 16);

    const mismatches: string[] = [];
    const unknownToLibrary = new Set<string>();
    const proxied = new Set<string>();
    let compared = 0;
    let otherAbilityCases = 0;
    let attackersRun = 0;

    for (const [, ap] of attackers) {
      const aAbility = topAbility(ap);
      if (!aAbility) continue;
      const aItem = ap.items?.[0]?.displayName as string | undefined;
      const moves = Object.entries(ap.moveUsage as Record<string, number>)
        .sort((x, y) => y[1] - x[1])
        .map(([slug]) => MOVES[slug])
        .filter((m): m is MoveSummary => !!m && !!moveToCalcMove(m))
        .slice(0, 5);
      let ran = false;
      for (const meta of moves) {
        for (const [dSlug, dp] of defenders) {
          if (dp.smogonName === ap.smogonName) continue;
          const dTop = topAbility(dp);
          if (!dTop) continue;
          const dItem = dp.items?.[0]?.displayName as string | undefined;
          const dAbilities = [dTop, ...(FORM_ABILITIES.get(dSlug) ?? []).filter((n) => toID(n) !== toID(dTop))];
          for (const dAbility of dAbilities) {
            let pair: Pair | null;
            try {
              pair = runBoth({ profile: ap, ability: aAbility, item: aItem }, { profile: dp, ability: dAbility, item: dItem }, meta);
            } catch {
              continue; // a species the library can't build
            }
            if (!pair || !pair.expected || !pair.bpOk) continue;
            for (const n of [aAbility, dAbility]) {
              if (championsProxy(n, "attacker", meta)) proxied.add(n);
              else if (!GEN.abilities.get(toID(n) as any)) unknownToLibrary.add(n);
            }
            compared++;
            ran = true;
            if (dAbility !== dTop) otherAbilityCases++;
            if (JSON.stringify(pair.got) !== JSON.stringify(pair.expected) && mismatches.length < 25) {
              mismatches.push(
                `${ap.smogonName} (${aAbility} @ ${aItem}) ${meta.displayName} -> ${dp.smogonName} (${dAbility} @ ${dItem})\n` +
                  `   mine: ${pair.got.join(",")}\n   calc: ${pair.expected.join(",")}`,
              );
            }
          }
        }
      }
      if (ran) attackersRun++;
    }

    // Non-vacuous: thousands of real-set cases, most of the top 60 attackers,
    // a real second pass over the defenders' other abilities, and the
    // Champions-original abilities in this slice (Mega Pyroar's Fire Mane, Mega
    // Scovillain's Spicy Spray, Mega Lucario Z's Aura Guard) went through their
    // library stand-ins.
    expect(compared).toBeGreaterThan(3000);
    expect(attackersRun).toBeGreaterThan(50);
    expect(otherAbilityCases).toBeGreaterThan(1000);
    expect([...proxied].length).toBeGreaterThan(0);
    // An ability the library doesn't know and no stand-in covers would be
    // silently ignored on its side — and the case would pass for the wrong reason.
    expect([...unknownToLibrary], "abilities the library can't model").toEqual([]);
    expect(mismatches, `\n${mismatches.join("\n")}`).toEqual([]);
  }, SWEEP_TIMEOUT);
});

describe("spread moves — the doubles ×0.75", () => {
  // PokeAPI's `target` is wrong often enough to matter (it served Matcha Gotcha
  // as single-target), and a wrong value silently misprices damage by 33% with
  // nothing else in the app noticing. The generator reconciles the spread axis
  // against Showdown; this is the net that proves it stayed reconciled — over
  // the WHOLE move index, not just the matchups the parity suite happens to hit.
  it("classifies every move exactly as @smogon/calc does", () => {
    const drift: string[] = [];
    let checked = 0;
    for (const meta of Object.values(MOVES) as MoveSummary[]) {
      let calcMove;
      try {
        calcMove = new Move(GEN, meta.displayName);
      } catch {
        continue; // move the library doesn't carry — nothing to compare against
      }
      checked++;
      const calcSpread = ["allAdjacent", "allAdjacentFoes"].includes(calcMove.target as string);
      if (calcSpread !== isSpreadMove(meta.target)) {
        drift.push(`${meta.name}: ours=${meta.target} calc=${calcMove.target}`);
      }
    }
    expect(checked).toBeGreaterThan(400);
    expect(drift, `\n${drift.join("\n")}`).toEqual([]);
  });

  const profile = (name: string) =>
    Object.values(master).find((p: any) => p.smogonName === name && !p.asForm) as any;

  it("drops the ×0.75 when only one target is left", () => {
    const a = build(profile("Kingambit"), "Illuminate", undefined).mine;
    const d = build(profile("Incineroar"), "Illuminate", undefined).mine;
    const rockSlide = moveToCalcMove(MOVES["rock-slide"] as MoveSummary)!;

    const both = computeDamage(a, d, rockSlide, { gameType: "Doubles" });
    const lone = computeDamage(a, d, rockSlide, { gameType: "Doubles", singleTarget: true });

    // Full power is strictly bigger, and lands within a roll of 1/0.75 — the
    // ratio is not exactly 4/3 because the cut cuts base damage before the rolls.
    expect(lone.maxDamage).toBeGreaterThan(both.maxDamage);
    expect(lone.maxDamage / both.maxDamage).toBeGreaterThan(1.3);
    expect(lone.maxDamage / both.maxDamage).toBeLessThan(1.37);

    // …and the flag must not leak into single-target moves.
    const kowtow = moveToCalcMove(MOVES["kowtow-cleave"] as MoveSummary)!;
    expect(computeDamage(a, d, kowtow, { gameType: "Doubles", singleTarget: true }).damage).toEqual(
      computeDamage(a, d, kowtow, { gameType: "Doubles" }).damage,
    );
  });

  it("leaves the screen modifier alone (the Singles-flip trap)", () => {
    const a = build(profile("Kingambit"), "Illuminate", undefined).mine;
    const d = build(profile("Incineroar"), "Illuminate", undefined).mine;
    const rockSlide = moveToCalcMove(MOVES["rock-slide"] as MoveSummary)!;

    // Modelling "one target" as Singles would also swap Reflect 2/3 → 1/2.
    const lone = computeDamage(a, d, rockSlide, {
      gameType: "Doubles", singleTarget: true, reflect: true,
    });
    const asSingles = computeDamage(a, d, rockSlide, { gameType: "Singles", reflect: true });
    expect(lone.maxDamage).toBeGreaterThan(asSingles.maxDamage);
  });
});

describe("damage engine — modeled abilities & field modifiers parity", () => {
  const terrain = (t: NonNullable<Terrain>) => new Field({ gameType: "Doubles", terrain: t });
  const weather = (w: NonNullable<Weather>) => new Field({ gameType: "Doubles", weather: w });

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
    defBoosts?: Record<string, number>;
    aStatus?: "brn" | "par" | "psn" | "tox";
    dStatus?: "brn" | "par" | "psn" | "tox" | "slp";
    /** Attacker / defender current HP % (both engines). */
    aHp?: number;
    dHp?: number;
    /** Force a crit: the library's `Move({ isCrit })` vs our `field.isCritical`. */
    crit?: boolean;
    /** A hand-picked library stand-in for the attacker's ability (documented per pin). */
    libAbility?: string;
  }

  const reflect = new Field({ gameType: "Doubles", defenderSide: { isReflect: true } });
  const veil = new Field({ gameType: "Doubles", defenderSide: { isAuroraVeil: true } });
  const hh = new Field({ gameType: "Doubles", attackerSide: { isHelpingHand: true } });

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
    // Moves that swap which stat attacks / how BP is set. These two shipped
    // WRONG for months purely because the meta sample above never happened to
    // pick them up (Body Press only reached the sample when Mega Metagross
    // climbed the ladder), so they are pinned by hand here — not left to the
    // sample's luck.
    { name: "Body Press (attacks with user's Def)", atk: "Garchomp", def: "Incineroar", move: "body-press" },
    { name: "Body Press +2 Def (Iron Defense combo)", atk: "Garchomp", def: "Incineroar", move: "body-press", atkBoosts: { def: 2 } },
    { name: "Knock Off ×1.5 (target holds an item)", atk: "Garchomp", def: "Incineroar", move: "knock-off", dItem: "Sitrus Berry" },
    { name: "Knock Off plain (target has no item)", atk: "Garchomp", def: "Incineroar", move: "knock-off" },
    { name: "Knock Off plain (Mega Stone can't be removed)", atk: "Garchomp", def: "Charizard-Mega-Y", move: "knock-off", dItem: "Charizardite Y" },
    // v1.2.0 held items that change a damage roll. The 2026-08 ladder predates
    // the update, so NO meta sample can reach these — pinned by hand, same as
    // Body Press / Knock Off.
    { name: "Normal Gem ×1.3 on a Normal move", atk: "Kingambit", def: "Garchomp", move: "body-slam", item: "Normal Gem" },
    { name: "Normal Gem does nothing off-type", atk: "Kingambit", def: "Garchomp", move: "iron-head", item: "Normal Gem" },
    // Variable-power moves (BP from weight / speed).
    { name: "Low Kick (target weight)", atk: "Garchomp", def: "Kingambit", move: "low-kick" },
    { name: "Grass Knot (target weight)", atk: "Garchomp", def: "Kingambit", move: "grass-knot" },
    { name: "Heavy Slam (weight ratio)", atk: "Kingambit", def: "Garchomp", move: "heavy-slam" },
    { name: "Gyro Ball (speed)", atk: "Kingambit", def: "Garchomp", move: "gyro-ball" },
    { name: "Electro Ball (speed)", atk: "Garchomp", def: "Kingambit", move: "electro-ball" },
    // Terrain + the moves that fail outright. Reg M-C (2026-09) made terrain
    // central — Indeedee-F's Psychic Surge on ~1 in 5 teams — and Steel Roller
    // reached Mega Metagross's top moves, which is how the 2026-10-01 refresh
    // went red: the engine rolled full damage where the move FAILS with no
    // terrain. Every terrain branch is pinned here, not left to the sample.
    { name: "Steel Roller fails with no terrain", atk: "Kingambit", def: "Incineroar", move: "steel-roller" },
    { name: "Steel Roller hits in any terrain", atk: "Kingambit", def: "Incineroar", move: "steel-roller", field: terrain("Psychic") },
    { name: "Poltergeist fails into an itemless target", atk: "Kingambit", def: "Incineroar", move: "poltergeist" },
    { name: "Poltergeist hits a target holding an item", atk: "Kingambit", def: "Incineroar", move: "poltergeist", dItem: "Sitrus Berry" },
    { name: "Psychic Terrain blocks priority into a grounded target", atk: "Incineroar", def: "Garchomp", move: "fake-out", field: terrain("Psychic") },
    { name: "Psychic Terrain lets priority hit a Flying target", atk: "Incineroar", def: "Charizard", move: "fake-out", field: terrain("Psychic") },
    { name: "Psychic Terrain boosts a grounded user's Psychic move", atk: "Incineroar", def: "Garchomp", move: "psychic", field: terrain("Psychic") },
    { name: "Expanding Force goes spread ×1.5 in Psychic Terrain", atk: "Incineroar", def: "Garchomp", move: "expanding-force", field: terrain("Psychic") },
    { name: "Electric Terrain boosts a grounded user's Electric move", atk: "Garchomp", def: "Incineroar", move: "thunderbolt", field: terrain("Electric") },
    { name: "Electric Terrain skips a Flying user", atk: "Charizard", def: "Incineroar", move: "thunderbolt", field: terrain("Electric") },
    { name: "Rising Voltage doubles into a grounded target", atk: "Garchomp", def: "Incineroar", move: "rising-voltage", field: terrain("Electric") },
    { name: "Terrain Pulse turns Electric at double power", atk: "Garchomp", def: "Incineroar", move: "terrain-pulse", field: terrain("Electric") },
    { name: "Grassy Terrain boosts a grounded user's Grass move", atk: "Garchomp", def: "Incineroar", move: "energy-ball", field: terrain("Grassy") },
    { name: "Grassy Terrain halves Earthquake", atk: "Garchomp", def: "Incineroar", move: "earthquake", field: terrain("Grassy") },
    { name: "Misty Terrain halves Dragon into a grounded target", atk: "Garchomp", def: "Incineroar", move: "dragon-claw", field: terrain("Misty") },
    { name: "Misty Explosion ×1.5 in Misty Terrain", atk: "Garchomp", def: "Incineroar", move: "misty-explosion", field: terrain("Misty") },
    { name: "Grassy Seed: +1 Def in Grassy Terrain", atk: "Garchomp", def: "Incineroar", move: "dragon-claw", dItem: "Grassy Seed", field: terrain("Grassy") },
    { name: "Psychic Seed: +1 SpD in Psychic Terrain", atk: "Charizard", def: "Incineroar", move: "flamethrower", dItem: "Psychic Seed", field: terrain("Psychic") },
    { name: "spent Seed no longer powers Knock Off", atk: "Garchomp", def: "Incineroar", move: "knock-off", dItem: "Grassy Seed", field: terrain("Grassy") },
    // Critical hits. The 2026-10 re-bake put Mega Froslass (Frost Breath on
    // ~38% of sets) into the sample and the sweep went red 8×, one per top
    // defender, every roll ≈2/3 of the library's (0.64–0.69): the engine only crit
    // when `field.isCritical` said so, and nothing in the app sets it — so an
    // always-crit move NEVER crit. Same lesson as Body Press / Knock Off, so
    // every branch of the crit rule is pinned here, not left to the sample.
    { name: "Frost Breath always crits", atk: "Charizard", def: "Garchomp", move: "frost-breath" },
    { name: "Storm Throw always crits (physical)", atk: "Garchomp", def: "Incineroar", move: "storm-throw" },
    { name: "Flower Trick always crits (PokeAPI's critRate says 0)", atk: "Kingambit", def: "Garchomp", move: "flower-trick" },
    { name: "Shell Armor cancels an always-crit", atk: "Charizard", def: "Garchomp", move: "frost-breath", dAbility: "Shell Armor" },
    { name: "Battle Armor cancels an always-crit", atk: "Garchomp", def: "Incineroar", move: "storm-throw", dAbility: "Battle Armor" },
    { name: "crit ignores the attacker's Atk drop (Intimidated Storm Throw)", atk: "Garchomp", def: "Incineroar", move: "storm-throw", atkBoosts: { atk: -1 } },
    { name: "crit keeps the attacker's Atk boost", atk: "Garchomp", def: "Incineroar", move: "storm-throw", atkBoosts: { atk: 2 } },
    { name: "crit ignores the target's Def boost", atk: "Garchomp", def: "Incineroar", move: "storm-throw", defBoosts: { def: 2 } },
    { name: "crit keeps the target's Def drop", atk: "Garchomp", def: "Incineroar", move: "storm-throw", defBoosts: { def: -1 } },
    { name: "crit goes through Reflect", atk: "Garchomp", def: "Incineroar", move: "storm-throw", field: reflect },
    { name: "crit goes through Aurora Veil (the calc's Screens chip)", atk: "Charizard", def: "Garchomp", move: "frost-breath", field: veil },
    { name: "Choice Specs still applies on a crit", atk: "Charizard", def: "Garchomp", move: "frost-breath", item: "Choice Specs" },
    { name: "Choice Band still applies on a crit", atk: "Garchomp", def: "Incineroar", move: "storm-throw", item: "Choice Band" },
    { name: "Sniper ×1.5 on a crit", atk: "Charizard", def: "Garchomp", move: "frost-breath", ability: "Sniper" },
    { name: "Sniper does nothing without a crit", atk: "Charizard", def: "Garchomp", move: "ice-beam", ability: "Sniper" },
    { name: "Merciless crits a poisoned target", atk: "Garchomp", def: "Incineroar", move: "dragon-claw", ability: "Merciless", dStatus: "psn" },
    { name: "Merciless leaves a healthy target alone", atk: "Garchomp", def: "Incineroar", move: "dragon-claw", ability: "Merciless" },
    { name: "Shell Armor stops Merciless too", atk: "Garchomp", def: "Incineroar", move: "dragon-claw", ability: "Merciless", dStatus: "tox", dAbility: "Shell Armor" },
    { name: "a forced crit (field.isCritical) on an ordinary move", atk: "Garchomp", def: "Incineroar", move: "dragon-claw", crit: true, atkBoosts: { atk: -1 } },
    { name: "Battle Armor cancels a forced crit", atk: "Garchomp", def: "Incineroar", move: "dragon-claw", crit: true, dAbility: "Battle Armor" },
    // ---- Abilities ON (2026-11-18). Group A neutralizes every ability, so
    // none of these could fail there; Group C caught the common ones on real
    // sets (891 of 8515 cases red before this port). Every branch is pinned
    // here so a ladder month that stops sampling it can't hide a regression.
    // -ate family + other type changers.
    { name: "Pixilate: Hyper Voice turns Fairy at 1.2× (Sylveon into Garchomp)", atk: "Sylveon", def: "Garchomp", move: "hyper-voice", ability: "Pixilate" },
    { name: "Pixilate Hyper Voice now hits a Ghost (Basculegion)", atk: "Sylveon", def: "Basculegion", move: "hyper-voice", ability: "Pixilate" },
    { name: "Pixilate + Fairy Feather: the type item follows the new type", atk: "Sylveon", def: "Kingambit", move: "hyper-voice", ability: "Pixilate", item: "Fairy Feather" },
    { name: "Pixilate leaves a non-Normal move alone (Moonblast)", atk: "Sylveon", def: "Garchomp", move: "moonblast", ability: "Pixilate" },
    { name: "Pixilate never retypes Weather Ball (Sun: Fire, no 1.2×)", atk: "Sylveon", def: "Kingambit", move: "weather-ball", ability: "Pixilate", field: weather("Sun") },
    { name: "Aerilate: Mega Salamence's Hyper Voice turns Flying (into Rillaboom)", atk: "Salamence-Mega", def: "Rillaboom", move: "hyper-voice", ability: "Aerilate" },
    { name: "Refrigerate: Mega Glalie's Body Slam turns Ice (into Garchomp)", atk: "Glalie-Mega", def: "Garchomp", move: "body-slam", ability: "Refrigerate" },
    { name: "Galvanize: Body Slam turns Electric (into Pelipper)", atk: "Kingambit", def: "Pelipper", move: "body-slam", ability: "Galvanize" },
    { name: "Normalize: every move turns Normal at 1.2×", atk: "Garchomp", def: "Incineroar", move: "earthquake", ability: "Normalize" },
    { name: "Liquid Voice: Primarina's Hyper Voice turns Water (no 1.2×)", atk: "Primarina", def: "Incineroar", move: "hyper-voice", ability: "Liquid Voice" },
    { name: "Liquid Voice Hyper Voice now hits a Ghost", atk: "Primarina", def: "Basculegion", move: "hyper-voice", ability: "Liquid Voice" },
    // Dragonize — Champions-original (Mega Feraligatr). Oracle: the move
    // pre-typed Dragon at pokeRound(120 × 4915/4096) = 144 (championsProxy),
    // plus one pin against the library's Aerilate for its place in the chain.
    { name: "Dragonize: Double-Edge turns Dragon at 1.2× (into Incineroar)", atk: "Feraligatr-Mega", def: "Incineroar", move: "double-edge", ability: "Dragonize" },
    { name: "Dragonize Double-Edge is resisted by Steel (Kingambit)", atk: "Feraligatr-Mega", def: "Kingambit", move: "double-edge", ability: "Dragonize" },
    { name: "Dragonize Double-Edge can't touch a Fairy (Mega Floette)", atk: "Feraligatr-Mega", def: "Floette-Mega", move: "double-edge", ability: "Dragonize" },
    { name: "Dragonize sits on Aerilate's rung (after Helping Hand)", atk: "Salamence-Mega", def: "Incineroar", move: "hyper-voice", ability: "Dragonize", libAbility: "Aerilate", field: hh },
    { name: "Dragonize never retypes Weather Ball (Rain: Water)", atk: "Feraligatr-Mega", def: "Incineroar", move: "weather-ball", ability: "Dragonize", field: weather("Rain") },
    { name: "Raging Bull takes the Paldean breed's type (Aqua: Water)", atk: "Tauros-Paldea-Aqua", def: "Incineroar", move: "raging-bull" },
    { name: "Raging Bull stays Normal on Kantonian Tauros", atk: "Tauros", def: "Incineroar", move: "raging-bull" },
    // The 1.5× / 1.3× / 1.2× ability rungs of the BP chain.
    { name: "Sharpness: Sacred Sword (slicing) ×1.5", atk: "Gallade", def: "Incineroar", move: "sacred-sword", ability: "Sharpness" },
    { name: "Sharpness skips a non-slicing move", atk: "Gallade", def: "Incineroar", move: "close-combat", ability: "Sharpness" },
    { name: "Mega Launcher: Aura Sphere (pulse) ×1.5", atk: "Blastoise-Mega", def: "Incineroar", move: "aura-sphere", ability: "Mega Launcher" },
    { name: "Mega Launcher: Dark Pulse ×1.5", atk: "Blastoise-Mega", def: "Farigiraf", move: "dark-pulse", ability: "Mega Launcher" },
    { name: "Strong Jaw: Crunch (bite) ×1.5", atk: "Sharpedo-Mega", def: "Farigiraf", move: "crunch", ability: "Strong Jaw" },
    { name: "Steely Spirit: the user's Steel moves ×1.5", atk: "Perrserker", def: "Sylveon", move: "iron-head", ability: "Steely Spirit" },
    { name: "Iron Fist: Drain Punch (punch) ×1.2", atk: "Conkeldurr", def: "Kingambit", move: "drain-punch", ability: "Iron Fist" },
    { name: "Reckless: Brave Bird (recoil) ×1.2", atk: "Staraptor", def: "Rillaboom", move: "brave-bird", ability: "Reckless" },
    { name: "Reckless: High Jump Kick (crash damage) ×1.2", atk: "Staraptor", def: "Kingambit", move: "high-jump-kick", ability: "Reckless" },
    { name: "Reckless: Wave Crash (PokeAPI serves no recoil) ×1.2", atk: "Basculegion", def: "Incineroar", move: "wave-crash", ability: "Reckless" },
    { name: "Reckless skips Close Combat (a self-drop, not recoil)", atk: "Staraptor", def: "Kingambit", move: "close-combat", ability: "Reckless" },
    { name: "Punk Rock (attacker): Boomburst (sound) ×1.3", atk: "Toxtricity", def: "Incineroar", move: "boomburst", ability: "Punk Rock" },
    { name: "Punk Rock (defender) halves a sound move", atk: "Sylveon", def: "Toxtricity", move: "hyper-voice", dAbility: "Punk Rock" },
    { name: "Sand Force: Earthquake ×1.3 in Sand", atk: "Garchomp-Mega", def: "Incineroar", move: "earthquake", ability: "Sand Force", field: weather("Sand") },
    { name: "Sand Force: Iron Head (Steel) ×1.3 in Sand", atk: "Garchomp-Mega", def: "Sylveon", move: "iron-head", ability: "Sand Force", field: weather("Sand") },
    { name: "Sand Force does nothing without Sand", atk: "Garchomp-Mega", def: "Incineroar", move: "earthquake", ability: "Sand Force" },
    { name: "Fairy Aura (attacker): Mega Floette's Moonblast ×1.33", atk: "Floette-Mega", def: "Garchomp", move: "moonblast", ability: "Fairy Aura" },
    { name: "Fairy Aura (defender) powers the ATTACKER's Fairy move too", atk: "Sylveon", def: "Floette-Mega", move: "moonblast", dAbility: "Fairy Aura" },
    { name: "Aura Break turns Fairy Aura into ×0.75", atk: "Floette-Mega", def: "Garchomp", move: "moonblast", ability: "Fairy Aura", dAbility: "Aura Break" },
    { name: "Dark Aura: Kowtow Cleave ×1.33", atk: "Kingambit", def: "Farigiraf", move: "kowtow-cleave", ability: "Dark Aura" },
    { name: "Analytic ×1.3 when moving last", atk: "Kingambit", def: "Sneasler", move: "iron-head", ability: "Analytic" },
    { name: "Analytic does nothing when moving first", atk: "Sneasler", def: "Kingambit", move: "close-combat", ability: "Analytic" },
    { name: "Sheer Force skips Close Combat (PokeAPI calls its self-drop a secondary)", atk: "Conkeldurr", def: "Kingambit", move: "close-combat", ability: "Sheer Force" },
    { name: "Sheer Force skips Fire Spin (binding isn't a secondary)", atk: "Charizard", def: "Kingambit", move: "fire-spin", ability: "Sheer Force" },
    { name: "Sheer Force boosts Alluring Voice (a secondary PokeAPI has no field for)", atk: "Sylveon", def: "Garchomp", move: "alluring-voice", ability: "Sheer Force" },
    { name: "Sheer Force boosts Flamethrower (burn chance)", atk: "Charizard", def: "Kingambit", move: "flamethrower", ability: "Sheer Force" },
    { name: "Sheer Force boosts Electro Shot (the library special-cases its self-boost)", atk: "Archaludon", def: "Pelipper", move: "electro-shot", ability: "Sheer Force" },
    { name: "Dry Skin takes 1.25× from Fire", atk: "Charizard", def: "Toxicroak", move: "flamethrower", dAbility: "Dry Skin" },
    { name: "Dry Skin is immune to Water", atk: "Primarina", def: "Toxicroak", move: "liquidation", dAbility: "Dry Skin" },
    // The attack chain.
    { name: "Hustle: physical Attack ×1.5, outside the chain", atk: "Flapple", def: "Garchomp", move: "grav-apple", ability: "Hustle" },
    { name: "Hustle leaves special moves alone", atk: "Flapple", def: "Garchomp", move: "dragon-pulse", ability: "Hustle" },
    { name: "Gorilla Tactics: physical ×1.5", atk: "Garchomp", def: "Incineroar", move: "earthquake", ability: "Gorilla Tactics" },
    { name: "Solar Power: special ×1.5 in Sun", atk: "Charizard", def: "Kingambit", move: "flamethrower", ability: "Solar Power", field: weather("Sun") },
    { name: "Solar Power does nothing without Sun", atk: "Charizard", def: "Kingambit", move: "flamethrower", ability: "Solar Power" },
    { name: "Steelworker: Steel ×1.5", atk: "Kingambit", def: "Sylveon", move: "iron-head", ability: "Steelworker" },
    { name: "Dragon's Maw: Dragon ×1.5", atk: "Garchomp", def: "Incineroar", move: "dragon-claw", ability: "Dragon's Maw" },
    { name: "Rocky Payload: Rock ×1.5", atk: "Garchomp", def: "Incineroar", move: "rock-slide", ability: "Rocky Payload" },
    { name: "Transistor: Electric ×1.3 (gen 9)", atk: "Garchomp", def: "Pelipper", move: "thunder-punch", ability: "Transistor" },
    // Fire Mane — Champions-original (Mega Pyroar). Oracle: the library's
    // ACTIVATED Flash Fire (same 6144, same attack chain; championsProxy).
    { name: "Fire Mane: Fire ×1.5 (Mega Pyroar's Heat Wave)", atk: "Pyroar-Mega", def: "Kingambit", move: "heat-wave", ability: "Fire Mane" },
    { name: "Fire Mane: Overheat ×1.5", atk: "Pyroar-Mega", def: "Rillaboom", move: "overheat", ability: "Fire Mane" },
    { name: "Fire Mane leaves a non-Fire move alone", atk: "Pyroar-Mega", def: "Kingambit", move: "hyper-voice", ability: "Fire Mane" },
    { name: "Fire Mane does nothing defensively", atk: "Charizard", def: "Pyroar-Mega", move: "flamethrower", dAbility: "Fire Mane" },
    { name: "Blaze: Fire ×1.5 at ≤⅓ HP", atk: "Incineroar", def: "Kingambit", move: "flare-blitz", ability: "Blaze", aHp: 25 },
    { name: "Blaze does nothing above ⅓ HP", atk: "Incineroar", def: "Kingambit", move: "flare-blitz", ability: "Blaze", aHp: 50 },
    { name: "Torrent: Water ×1.5 at ≤⅓ HP", atk: "Primarina", def: "Incineroar", move: "liquidation", ability: "Torrent", aHp: 25 },
    { name: "Overgrow: Grass ×1.5 at ≤⅓ HP", atk: "Rillaboom", def: "Basculegion", move: "wood-hammer", ability: "Overgrow", aHp: 25 },
    { name: "Swarm: Bug ×1.5 at ≤⅓ HP", atk: "Volcarona", def: "Farigiraf", move: "bug-buzz", ability: "Swarm", aHp: 25 },
    { name: "Defeatist halves Attack at ≤½ HP", atk: "Garchomp", def: "Incineroar", move: "earthquake", ability: "Defeatist", aHp: 50 },
    { name: "Light Ball doubles Pikachu's attacks", atk: "Pikachu", def: "Pelipper", move: "thunderbolt", item: "Light Ball" },
    { name: "Light Ball does nothing for a non-Pikachu", atk: "Raichu", def: "Pelipper", move: "thunderbolt", item: "Light Ball" },
    { name: "Guts: ×1.5 when statused, and no burn halving", atk: "Conkeldurr", def: "Kingambit", move: "drain-punch", ability: "Guts", aStatus: "brn" },
    { name: "Facade doubles when burned (and ignores the burn)", atk: "Kingambit", def: "Incineroar", move: "facade", aStatus: "brn" },
    { name: "Facade doubles when paralyzed", atk: "Kingambit", def: "Incineroar", move: "facade", aStatus: "par" },
    // The defense chain.
    { name: "Fur Coat halves physical damage (an ABILITY — it was read off the item)", atk: "Garchomp", def: "Persian-Alola", move: "earthquake", dAbility: "Fur Coat" },
    { name: "Fur Coat leaves special damage alone", atk: "Charizard", def: "Persian-Alola", move: "flamethrower", dAbility: "Fur Coat" },
    { name: "Marvel Scale: Def ×1.5 while statused", atk: "Garchomp", def: "Milotic", move: "earthquake", dAbility: "Marvel Scale", dStatus: "brn" },
    { name: "Grass Pelt: Def ×1.5 in Grassy Terrain", atk: "Garchomp", def: "Gogoat", move: "dragon-claw", dAbility: "Grass Pelt", field: terrain("Grassy") },
    { name: "Darkest Lariat ignores the target's +2 Def", atk: "Incineroar", def: "Garchomp", move: "darkest-lariat", defBoosts: { def: 2 } },
    { name: "Darkest Lariat ignores a Def drop too", atk: "Incineroar", def: "Garchomp", move: "darkest-lariat", defBoosts: { def: -2 } },
    { name: "Sacred Sword ignores the target's +2 Def", atk: "Gallade", def: "Kingambit", move: "sacred-sword", defBoosts: { def: 2 } },
    // The final chain (defender side).
    { name: "Fluffy halves a contact move", atk: "Garchomp", def: "Houndstone", move: "dragon-claw", dAbility: "Fluffy" },
    { name: "Fluffy doubles a Fire move", atk: "Charizard", def: "Houndstone", move: "flamethrower", dAbility: "Fluffy" },
    { name: "Fluffy vs a Fire contact move: ×2 and ×½", atk: "Incineroar", def: "Houndstone", move: "flare-blitz", dAbility: "Fluffy" },
    { name: "Long Reach slips past Fluffy", atk: "Decidueye", def: "Houndstone", move: "leaf-blade", ability: "Long Reach", dAbility: "Fluffy" },
    { name: "Solid Rock: a super-effective hit ×0.75", atk: "Garchomp", def: "Kingambit", move: "earthquake", dAbility: "Solid Rock" },
    { name: "Prism Armor holds against Mold Breaker", atk: "Garchomp", def: "Kingambit", move: "earthquake", ability: "Mold Breaker", dAbility: "Prism Armor" },
    // Aura Guard — Champions-original (Mega Lucario Z). Oracle: Fluffy's
    // contact half (Multiscale at full HP for a Fire contact move; championsProxy).
    { name: "Aura Guard halves a contact move", atk: "Garchomp", def: "Lucario-Mega-Z", move: "dragon-claw", dAbility: "Aura Guard" },
    { name: "Aura Guard halves a Fire contact move (no Fluffy-style ×2)", atk: "Incineroar", def: "Lucario-Mega-Z", move: "flare-blitz", dAbility: "Aura Guard" },
    { name: "Aura Guard ignores a non-contact move", atk: "Garchomp", def: "Lucario-Mega-Z", move: "earthquake", dAbility: "Aura Guard" },
    { name: "Mold Breaker breaks Aura Guard", atk: "Garchomp", def: "Lucario-Mega-Z", move: "dragon-claw", ability: "Mold Breaker", dAbility: "Aura Guard" },
    { name: "Long Reach slips past Aura Guard", atk: "Decidueye", def: "Lucario-Mega-Z", move: "leaf-blade", ability: "Long Reach", dAbility: "Aura Guard" },
    // Resist berries (every one in the pool is pinned in its own suite below).
    { name: "Chople Berry halves Close Combat into Kingambit", atk: "Conkeldurr", def: "Kingambit", move: "close-combat", dItem: "Chople Berry" },
    { name: "a resist berry ignores a resisted hit", atk: "Garchomp", def: "Kingambit", move: "dragon-claw", dItem: "Haban Berry" },
    { name: "Chilan Berry halves any Normal hit", atk: "Kingambit", def: "Garchomp", move: "body-slam", dItem: "Chilan Berry" },
    { name: "Unnerve keeps the berry uneaten", atk: "Conkeldurr", def: "Kingambit", move: "close-combat", ability: "Unnerve", dItem: "Chople Berry" },
    { name: "Ripen doubles the berry (¼)", atk: "Garchomp", def: "Appletun", move: "ice-beam", dAbility: "Ripen", dItem: "Yache Berry" },
    // Immunities, priority blocks, ability-ignoring.
    { name: "Soundproof blocks Hyper Voice (Kommo-o)", atk: "Sylveon", def: "Kommo-o", move: "hyper-voice", dAbility: "Soundproof" },
    { name: "Bulletproof blocks Shadow Ball", atk: "Gengar-Mega", def: "Kommo-o", move: "shadow-ball", dAbility: "Bulletproof" },
    { name: "Armor Tail stops Fake Out (Farigiraf)", atk: "Incineroar", def: "Farigiraf", move: "fake-out", dAbility: "Armor Tail" },
    { name: "Armor Tail lets a normal-priority move through", atk: "Kingambit", def: "Farigiraf", move: "kowtow-cleave", dAbility: "Armor Tail" },
    { name: "Queenly Majesty stops Sucker Punch", atk: "Kingambit", def: "Tsareena", move: "sucker-punch", dAbility: "Queenly Majesty" },
    { name: "Mold Breaker: Earthquake hits through Levitate", atk: "Excadrill", def: "Garchomp-Mega-Z", move: "earthquake", ability: "Mold Breaker", dAbility: "Levitate" },
    { name: "Mold Breaker: priority hits through Armor Tail", atk: "Kingambit", def: "Farigiraf", move: "sucker-punch", ability: "Mold Breaker", dAbility: "Armor Tail" },
    { name: "Mold Breaker ignores Multiscale", atk: "Garchomp", def: "Dragonite-Mega", move: "dragon-claw", ability: "Mold Breaker", dAbility: "Multiscale" },
    { name: "Mold Breaker crits through Battle Armor", atk: "Garchomp", def: "Incineroar", move: "storm-throw", ability: "Mold Breaker", dAbility: "Battle Armor" },
    { name: "Mold Breaker ignores Thick Fat", atk: "Charizard", def: "Incineroar", move: "flamethrower", ability: "Mold Breaker", dAbility: "Thick Fat" },
    { name: "Mold Breaker ignores Soundproof", atk: "Sylveon", def: "Kommo-o", move: "hyper-voice", ability: "Mold Breaker", dAbility: "Soundproof" },
    { name: "Teravolt is Mold Breaker too", atk: "Garchomp", def: "Garchomp-Mega-Z", move: "earthquake", ability: "Teravolt", dAbility: "Levitate" },
    { name: "Turboblaze is Mold Breaker too", atk: "Charizard", def: "Incineroar", move: "flamethrower", ability: "Turboblaze", dAbility: "Thick Fat" },
    { name: "Scrappy: Fake Out hits a Ghost", atk: "Kangaskhan", def: "Gengar-Mega", move: "fake-out", ability: "Scrappy" },
    { name: "Scrappy: Close Combat hits a Ghost", atk: "Pangoro", def: "Sinistcha", move: "close-combat", ability: "Scrappy" },
    { name: "Mind's Eye: Normal hits a Ghost", atk: "Kangaskhan", def: "Basculegion", move: "body-slam", ability: "Mind's Eye" },
    { name: "without Scrappy, Fake Out can't touch a Ghost", atk: "Kangaskhan", def: "Gengar-Mega", move: "fake-out" },
    // Eelevate — Champions-original (Mega Eelektross). Oracle: Levitate.
    { name: "Eelevate: immune to Ground", atk: "Garchomp", def: "Eelektross-Mega", move: "earthquake", dAbility: "Eelevate" },
    { name: "Mold Breaker breaks Eelevate", atk: "Excadrill", def: "Eelektross-Mega", move: "earthquake", ability: "Mold Breaker", dAbility: "Eelevate" },
    { name: "Iron Ball grounds an Eelevate holder", atk: "Garchomp", def: "Eelektross-Mega", move: "earthquake", dAbility: "Eelevate", dItem: "Iron Ball" },
    { name: "an Eelevate user floats above Electric Terrain (no 1.3×)", atk: "Eelektross-Mega", def: "Pelipper", move: "thunderbolt", ability: "Eelevate", field: terrain("Electric") },
    { name: "Eelevate lets priority through Psychic Terrain", atk: "Kingambit", def: "Eelektross-Mega", move: "sucker-punch", dAbility: "Eelevate", field: terrain("Psychic") },
    // Items that move the field: Iron Ball, Klutz, screens, weather.
    { name: "Iron Ball grounds a Flying type (the library's neutral)", atk: "Garchomp", def: "Corviknight", move: "earthquake", dItem: "Iron Ball" },
    { name: "Iron Ball grounds a Levitate holder", atk: "Garchomp", def: "Bronzong", move: "earthquake", dAbility: "Levitate", dItem: "Iron Ball" },
    { name: "Klutz: the holder's Life Orb does nothing", atk: "Lopunny", def: "Incineroar", move: "high-jump-kick", ability: "Klutz", item: "Life Orb" },
    { name: "Klutz: the target's Air Balloon doesn't float it", atk: "Garchomp", def: "Golurk", move: "earthquake", dAbility: "Klutz", dItem: "Air Balloon" },
    { name: "Klutz: Knock Off still takes its 1.5× (the item is still there)", atk: "Kingambit", def: "Audino", move: "knock-off", dAbility: "Klutz", dItem: "Sitrus Berry" },
    { name: "Klutz: Poltergeist fails (the library treats the item as gone)", atk: "Kingambit", def: "Golurk", move: "poltergeist", dAbility: "Klutz", dItem: "Sitrus Berry" },
    { name: "Infiltrator walks through Reflect", atk: "Garchomp", def: "Incineroar", move: "dragon-claw", ability: "Infiltrator", field: reflect },
    { name: "Infiltrator walks through Aurora Veil", atk: "Charizard", def: "Kingambit", move: "flamethrower", ability: "Infiltrator", field: veil },
    { name: "Brick Break shatters Reflect first", atk: "Conkeldurr", def: "Kingambit", move: "brick-break", field: reflect },
    { name: "Psychic Fangs shatters Aurora Veil first", atk: "Garchomp", def: "Sneasler", move: "psychic-fangs", field: veil },
    { name: "Raging Bull shatters Reflect first", atk: "Tauros-Paldea-Aqua", def: "Incineroar", move: "raging-bull", field: reflect },
    { name: "Cloud Nine (defender) switches the Rain off", atk: "Primarina", def: "Altaria", move: "liquidation", dAbility: "Cloud Nine", field: weather("Rain") },
    { name: "Cloud Nine (attacker) switches the Sun off", atk: "Altaria", def: "Kingambit", move: "flamethrower", ability: "Cloud Nine", field: weather("Sun") },
    { name: "Forecast: Castform turns Water in Rain (Weather Ball STAB)", atk: "Castform", def: "Incineroar", move: "weather-ball", ability: "Forecast", field: weather("Rain") },
    { name: "Forecast: Castform turns Fire in Sun", atk: "Castform", def: "Kingambit", move: "weather-ball", ability: "Forecast", field: weather("Sun") },
    // Weather Ball / Solar Beam / Mega Sol.
    { name: "Weather Ball: Normal 50 with no weather", atk: "Charizard", def: "Kingambit", move: "weather-ball" },
    { name: "Weather Ball: Fire 100 in Sun", atk: "Charizard", def: "Kingambit", move: "weather-ball", field: weather("Sun") },
    { name: "Weather Ball: Water 100 in Rain", atk: "Charizard", def: "Incineroar", move: "weather-ball", field: weather("Rain") },
    { name: "Weather Ball: Rock 100 in Sand", atk: "Garchomp", def: "Charizard", move: "weather-ball", field: weather("Sand") },
    { name: "Weather Ball: Ice 100 in Snow", atk: "Charizard", def: "Garchomp", move: "weather-ball", field: weather("Snow") },
    { name: "Solar Beam halves in Rain", atk: "Venusaur", def: "Basculegion", move: "solar-beam", field: weather("Rain") },
    { name: "Solar Beam halves in Sand", atk: "Venusaur", def: "Basculegion", move: "solar-beam", field: weather("Sand") },
    { name: "Solar Beam halves in Snow", atk: "Venusaur", def: "Basculegion", move: "solar-beam", field: weather("Snow") },
    { name: "Solar Beam at full power in Sun", atk: "Venusaur", def: "Basculegion", move: "solar-beam", field: weather("Sun") },
    { name: "Solar Blade halves in Rain", atk: "Venusaur", def: "Basculegion", move: "solar-blade", field: weather("Rain") },
    // Mega Sol — Champions-original (Mega Meganium). Oracle: the library with
    // Sun up for its moves, whatever the real weather (championsProxy).
    { name: "Mega Sol: Weather Ball is a 100-BP Fire move with no weather", atk: "Meganium-Mega", def: "Kingambit", move: "weather-ball", ability: "Mega Sol" },
    { name: "Mega Sol: Weather Ball stays Fire even in Rain", atk: "Meganium-Mega", def: "Kingambit", move: "weather-ball", ability: "Mega Sol", field: weather("Rain") },
    { name: "Mega Sol: Solar Beam isn't halved in Rain", atk: "Meganium-Mega", def: "Basculegion", move: "solar-beam", ability: "Mega Sol", field: weather("Rain") },
    { name: "Mega Sol: its Water move is halved even in Rain", atk: "Meganium-Mega", def: "Incineroar", move: "hydro-pump", ability: "Mega Sol", field: weather("Rain") },
    { name: "Mega Sol leaves a weather-blind move alone (Dazzling Gleam)", atk: "Meganium-Mega", def: "Garchomp", move: "dazzling-gleam", ability: "Mega Sol" },
    { name: "Mega Sol is the attacker's: a Fire move INTO it gets no Sun", atk: "Charizard", def: "Meganium-Mega", move: "flamethrower", dAbility: "Mega Sol" },
    // Protean / Libero.
    { name: "Protean: every move is STAB (Greninja's Ice Beam)", atk: "Greninja", def: "Garchomp", move: "ice-beam", ability: "Protean" },
    { name: "Libero: every move is STAB (Cinderace's U-turn)", atk: "Cinderace", def: "Rillaboom", move: "u-turn", ability: "Libero" },
    // Parental Bond (Mega Kangaskhan): a second hit at ¼ base damage.
    { name: "Parental Bond: a ¼-power second hit (Double-Edge)", atk: "Kangaskhan-Mega", def: "Incineroar", move: "double-edge", ability: "Parental Bond" },
    { name: "Parental Bond: Fake Out hits twice too", atk: "Kangaskhan-Mega", def: "Incineroar", move: "fake-out", ability: "Parental Bond" },
    { name: "Parental Bond's child skips Multiscale", atk: "Kangaskhan-Mega", def: "Dragonite-Mega", move: "double-edge", ability: "Parental Bond", dAbility: "Multiscale" },
    { name: "Parental Bond into Stamina: the child lands at +1 Def", atk: "Kangaskhan-Mega", def: "Archaludon", move: "double-edge", ability: "Parental Bond", dAbility: "Stamina" },
    { name: "Parental Bond into Weak Armor: the child lands at −1 Def", atk: "Kangaskhan-Mega", def: "Armarouge", move: "crunch", ability: "Parental Bond", dAbility: "Weak Armor" },
    { name: "Parental Bond: Superpower's child hits at −1 Atk", atk: "Kangaskhan-Mega", def: "Kingambit", move: "superpower", ability: "Parental Bond" },
    { name: "Parental Bond skips a spread move (Rock Slide)", atk: "Kangaskhan-Mega", def: "Charizard", move: "rock-slide", ability: "Parental Bond" },
    { name: "Parental Bond: Seismic Toss hits twice (50 + 50)", atk: "Kangaskhan-Mega", def: "Incineroar", move: "seismic-toss", ability: "Parental Bond" },
    { name: "Parental Bond child into Mummy loses its ¼ (the library's model, mirrored)", atk: "Kangaskhan-Mega", def: "Cofagrigus", move: "sucker-punch", ability: "Parental Bond", dAbility: "Mummy" },
    // Multi-hit moves: each hit computed, then summed (as the library does).
    { name: "Population Bomb lands 10 hits (PokeAPI calls it single-hit)", atk: "Maushold", def: "Incineroar", move: "population-bomb", ability: "Technician" },
    { name: "Triple Axel: 20 / 40 / 60 per hit", atk: "Tsareena", def: "Garchomp", move: "triple-axel" },
    { name: "Skill Link: a 2–5-hit move lands all 5", atk: "Garchomp", def: "Incineroar", move: "rock-blast", ability: "Skill Link" },
    { name: "a 2–5-hit move lands 3 by default", atk: "Garchomp", def: "Basculegion", move: "bullet-seed" },
    { name: "Twin Beam lands 2 hits (PokeAPI calls it single-hit)", atk: "Sylveon", def: "Sneasler", move: "twin-beam" },
    { name: "Dragon Darts: 2 hits into one target", atk: "Garchomp", def: "Incineroar", move: "dragon-darts" },
    { name: "multi-hit into Multiscale: only the first hit is halved", atk: "Garchomp", def: "Dragonite-Mega", move: "scale-shot", dAbility: "Multiscale" },
    { name: "multi-hit into a resist berry: only the first hit", atk: "Garchomp", def: "Garchomp", move: "icicle-spear", dItem: "Yache Berry" },
    { name: "multi-hit into Stamina: +1 Def every hit", atk: "Garchomp", def: "Archaludon", move: "rock-blast", dAbility: "Stamina" },
    { name: "multi-hit into Weak Armor: −1 Def every hit", atk: "Garchomp", def: "Armarouge", move: "rock-blast", dAbility: "Weak Armor" },
    { name: "multi-hit into Seed Sower: Grassy Terrain from the second hit", atk: "Garchomp", def: "Incineroar", move: "bullet-seed", dAbility: "Seed Sower" },
    { name: "multi-hit into Sand Spit: Sand from the second hit (Sand Force)", atk: "Garchomp-Mega", def: "Incineroar", move: "rock-blast", ability: "Sand Force", dAbility: "Sand Spit" },
    { name: "Parental Bond into Water Compaction: the child lands at +2 Def", atk: "Kangaskhan-Mega", def: "Incineroar", move: "liquidation", ability: "Parental Bond", dAbility: "Water Compaction" },
    { name: "Parental Bond Gyro Ball into Gooey: the child at −1 Spe", atk: "Kangaskhan-Mega", def: "Garchomp", move: "gyro-ball", ability: "Parental Bond", dAbility: "Gooey" },
    { name: "Toxic Boost: physical ×1.5 while poisoned", atk: "Garchomp", def: "Incineroar", move: "dragon-claw", ability: "Toxic Boost", aStatus: "psn" },
    { name: "Flare Boost: special ×1.5 while burned", atk: "Charizard", def: "Kingambit", move: "flamethrower", ability: "Flare Boost", aStatus: "brn" },
    { name: "Wind Rider: immune to wind moves (Heat Wave)", atk: "Charizard", def: "Kingambit", move: "heat-wave", dAbility: "Wind Rider" },
    { name: "Wonder Guard: a neutral hit does nothing", atk: "Garchomp", def: "Incineroar", move: "dragon-claw", dAbility: "Wonder Guard" },
    { name: "Wonder Guard: a super-effective hit lands", atk: "Garchomp", def: "Incineroar", move: "earthquake", dAbility: "Wonder Guard" },
    // Charge moves the library computes on their attacking turn (+1 SpA).
    { name: "Electro Shot hits at +1 SpA (Archaludon)", atk: "Archaludon", def: "Pelipper", move: "electro-shot" },
    { name: "Meteor Beam hits at +1 SpA", atk: "Archaludon", def: "Charizard", move: "meteor-beam" },
    { name: "Contrary turns the charge boost into −1", atk: "Archaludon", def: "Pelipper", move: "electro-shot", ability: "Contrary" },
    { name: "Simple doubles the charge boost", atk: "Archaludon", def: "Pelipper", move: "electro-shot", ability: "Simple" },
    // HP-scaled and fixed-damage moves (the calc's HP control drives them).
    { name: "Eruption scales with the user's HP (50%)", atk: "Typhlosion-Hisui", def: "Kingambit", move: "eruption", aHp: 50 },
    { name: "Eruption at full HP is 150", atk: "Typhlosion-Hisui", def: "Kingambit", move: "eruption" },
    { name: "Water Spout at 75% HP", atk: "Primarina", def: "Incineroar", move: "water-spout", aHp: 75 },
    { name: "Flail at 25% HP", atk: "Garchomp", def: "Incineroar", move: "flail", aHp: 25 },
    { name: "Reversal at 4% HP is 200", atk: "Garchomp", def: "Kingambit", move: "reversal", aHp: 4 },
    { name: "Hard Press at the target's full HP", atk: "Archaludon", def: "Incineroar", move: "hard-press" },
    { name: "Hard Press into a half-HP target", atk: "Archaludon", def: "Incineroar", move: "hard-press", dHp: 50 },
    { name: "Seismic Toss: 50 fixed damage", atk: "Garchomp", def: "Incineroar", move: "seismic-toss" },
    { name: "Night Shade: 50, even into a resist", atk: "Gengar-Mega", def: "Incineroar", move: "night-shade" },
    { name: "Night Shade can't touch a Normal type", atk: "Gengar-Mega", def: "Kangaskhan", move: "night-shade" },
    { name: "Final Gambit deals the user's current HP", atk: "Garchomp", def: "Incineroar", move: "final-gambit", aHp: 75 },
    // Status- and stage-scaled moves.
    { name: "Hex doubles into a statused target", atk: "Gengar-Mega", def: "Incineroar", move: "hex", dStatus: "brn" },
    { name: "Hex is plain 65 into a healthy target", atk: "Gengar-Mega", def: "Incineroar", move: "hex" },
    { name: "Infernal Parade doubles into a statused target", atk: "Gengar-Mega", def: "Garchomp", move: "infernal-parade", dStatus: "par" },
    { name: "Barb Barrage doubles into a poisoned target", atk: "Garchomp", def: "Rillaboom", move: "barb-barrage", dStatus: "psn" },
    { name: "Venoshock doubles into a poisoned target (chain ×2)", atk: "Gengar-Mega", def: "Rillaboom", move: "venoshock", dStatus: "tox" },
    { name: "Stored Power: 20 + 20 per positive stage", atk: "Sylveon", def: "Sneasler", move: "stored-power", atkBoosts: { spa: 2, spd: 1, spe: 1 } },
    { name: "Power Trip ignores negative stages", atk: "Kingambit", def: "Farigiraf", move: "power-trip", atkBoosts: { atk: 1, spe: -1 } },
    { name: "Acrobatics doubles its BASE power, so Technician no longer applies", atk: "Hawlucha", def: "Rillaboom", move: "acrobatics", ability: "Technician" },
    { name: "Acrobatics with an item stays 55 — and Technician applies", atk: "Hawlucha", def: "Rillaboom", move: "acrobatics", ability: "Technician", item: "Life Orb" },
    // Final Speed (Gyro Ball / Electro Ball power, Payback / Analytic order).
    { name: "Gyro Ball reads the Choice Scarf Speed", atk: "Kingambit", def: "Garchomp", move: "gyro-ball", item: "Choice Scarf" },
    { name: "Gyro Ball: Iron Ball halves the user's Speed", atk: "Kingambit", def: "Garchomp", move: "gyro-ball", item: "Iron Ball" },
    { name: "Gyro Ball into a paralyzed target", atk: "Kingambit", def: "Garchomp", move: "gyro-ball", dStatus: "par" },
    { name: "Electro Ball reads the Choice Scarf Speed", atk: "Garchomp", def: "Pelipper", move: "electro-ball", item: "Choice Scarf" },
    { name: "Electro Ball: Swift Swim doubles Speed in Rain", atk: "Garchomp", def: "Pelipper", move: "electro-ball", ability: "Swift Swim", field: weather("Rain") },
    { name: "Electro Ball: Chlorophyll doubles Speed in Sun", atk: "Garchomp", def: "Pelipper", move: "electro-ball", ability: "Chlorophyll", field: weather("Sun") },
    { name: "Electro Ball from a paralyzed user", atk: "Garchomp", def: "Pelipper", move: "electro-ball", aStatus: "par" },
    { name: "Electro Ball: Quick Feet turns paralysis into ×1.5", atk: "Garchomp", def: "Pelipper", move: "electro-ball", ability: "Quick Feet", aStatus: "par" },
    { name: "Payback doubles when moving last", atk: "Kingambit", def: "Sneasler", move: "payback" },
    { name: "Payback reads the Scarf-boosted turn order", atk: "Kingambit", def: "Incineroar", move: "payback", item: "Choice Scarf" },
    // Weight.
    { name: "Heavy Slam: Heavy Metal doubles the user's weight", atk: "Aggron", def: "Garchomp", move: "heavy-slam", ability: "Heavy Metal" },
    { name: "Low Kick: Light Metal halves the target's weight", atk: "Garchomp", def: "Metagross", move: "low-kick", dAbility: "Light Metal" },
    { name: "Heavy Slam into a Light Metal target", atk: "Aggron", def: "Metagross", move: "heavy-slam", dAbility: "Light Metal" },
    { name: "Mold Breaker ignores the target's Light Metal", atk: "Garchomp", def: "Metagross", move: "low-kick", ability: "Mold Breaker", dAbility: "Light Metal" },
    // Odd ones.
    { name: "Flying Press is Fighting AND Flying (into Rillaboom)", atk: "Hawlucha", def: "Rillaboom", move: "flying-press" },
    { name: "Flying Press into Kingambit", atk: "Hawlucha", def: "Kingambit", move: "flying-press" },
    { name: "Shell Side Arm stays special when that hits harder", atk: "Slowbro-Galar", def: "Incineroar", move: "shell-side-arm" },
    { name: "Shell Side Arm turns physical (and contact) when that hits harder", atk: "Slowbro-Galar", def: "Incineroar", move: "shell-side-arm", atkBoosts: { atk: 6 } },
    // The weather stat boosts of the TARGET — and Mega Sol switching them off.
    // While a Mega Sol holder moves, Showdown's effectiveWeather() reads
    // 'sunnyday' for every Pokémon, and the Sand SpD / Snow Def boosts check it
    // (the proxy — the library with Sun up — agrees). Until 2026-11-18 the engine
    // kept them, so Mega Meganium's Grass hits into Mega Tyranitar in its own
    // Sand Stream read ⅔ of their damage.
    { name: "Sand: a Rock type's SpD ×1.5 against a special move", atk: "Venusaur", def: "Tyranitar-Mega", move: "energy-ball", field: weather("Sand") },
    { name: "Snow: an Ice type's Def ×1.5 against a physical move", atk: "Garchomp", def: "Glalie-Mega", move: "earthquake", field: weather("Snow") },
    { name: "Mega Sol: no Sand SpD boost for a Rock type (Energy Ball into Mega Tyranitar)", atk: "Meganium-Mega", def: "Tyranitar-Mega", move: "energy-ball", ability: "Mega Sol", field: weather("Sand") },
    { name: "Mega Sol: no Snow Def boost for an Ice type", atk: "Meganium-Mega", def: "Glalie-Mega", move: "earthquake", ability: "Mega Sol", field: weather("Snow") },
    // Spicy Spray — Champions-original (Mega Scovillain): the burn lands after
    // EVERY hit, so a multi-hit / Parental Bond user's later hits are burned.
    // Oracle: the library's own per-hit rolls, burned from hit 2 (spicySprayExpected).
    { name: "Spicy Spray: Population Bomb's hits 2–10 land burned (halved)", atk: "Maushold", def: "Scovillain-Mega", move: "population-bomb", ability: "Technician", dAbility: "Spicy Spray" },
    { name: "Spicy Spray: a Parental Bond child lands burned", atk: "Kangaskhan-Mega", def: "Scovillain-Mega", move: "double-edge", ability: "Parental Bond", dAbility: "Spicy Spray" },
    { name: "Spicy Spray: Guts turns the burn into ×1.5 from hit 2", atk: "Conkeldurr", def: "Scovillain-Mega", move: "rock-blast", ability: "Guts", dAbility: "Spicy Spray" },
    { name: "Spicy Spray: a Lum Berry cures the burn before the next hit", atk: "Aerodactyl-Mega", def: "Scovillain-Mega", move: "dual-wingbeat", item: "Lum Berry", dAbility: "Spicy Spray" },
    { name: "Spicy Spray can't burn a Fire type (Talonflame's Dual Wingbeat)", atk: "Talonflame", def: "Scovillain-Mega", move: "dual-wingbeat", dAbility: "Spicy Spray" },
    { name: "Spicy Spray: a burned special multi-hit move isn't halved", atk: "Greninja", def: "Scovillain-Mega", move: "water-shuriken", dAbility: "Spicy Spray" },
    { name: "Spicy Spray: Misty Terrain keeps a grounded user unburned", atk: "Garchomp", def: "Scovillain-Mega", move: "scale-shot", dAbility: "Spicy Spray", field: terrain("Misty") },
    { name: "Spicy Spray changes nothing for a single hit", atk: "Garchomp", def: "Scovillain-Mega", move: "dragon-claw", dAbility: "Spicy Spray" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      // A pin that returns early asserts NOTHING and still shows ✓ (that is how
      // the five variable-BP pins passed vacuously until 2026-11-17) — so every
      // pin must reach its comparison.
      expect.hasAssertions();
      const meta = MOVES[c.move];
      expect(meta, `move ${c.move} is not in the baked index`).toBeDefined();
      const pair = runBoth(
        { profile: find(c.atk), ability: c.ability ?? "Illuminate", item: c.item, boosts: c.atkBoosts, status: c.aStatus, hpPct: c.aHp, libAbility: c.libAbility },
        { profile: find(c.def), ability: c.dAbility ?? "Illuminate", item: c.dItem, boosts: c.defBoosts, status: c.dStatus, hpPct: c.dHp },
        meta,
        c.field ?? DOUBLES,
        { crit: c.crit },
      );
      expect(pair, "moveToCalcMove must model this move").not.toBeNull();
      // The library must carry the same base power (variable-BP moves: both 0),
      // know both abilities (else it silently ignores one) and return rolls.
      expect(pair!.bpOk, "library move data differs from the baked move").toBe(true);
      expect(pair!.libraryKnows, "the library doesn't know one of the abilities").toBe(true);
      expect(pair!.expected, "the library returned no damage array").not.toBeNull();
      expect(pair!.got, c.name).toEqual(pair!.expected);
    });
  }
});

// Each Spicy Spray pin above must exercise what its name claims: the spliced
// oracle differs from the plain library run exactly when the burn lands.
describe("Spicy Spray's oracle — burned from hit 2, never vacuous", () => {
  const cases: { atk: string; move: string; ability?: string; item?: string; field?: Field; burns: boolean }[] = [
    { atk: "Maushold", move: "population-bomb", ability: "Technician", burns: true },
    { atk: "Kangaskhan-Mega", move: "double-edge", ability: "Parental Bond", burns: true },
    { atk: "Conkeldurr", move: "rock-blast", ability: "Guts", burns: true },
    { atk: "Aerodactyl-Mega", move: "dual-wingbeat", item: "Lum Berry", burns: false },
    { atk: "Talonflame", move: "dual-wingbeat", burns: false },
    { atk: "Greninja", move: "water-shuriken", burns: false },
    { atk: "Garchomp", move: "scale-shot", field: new Field({ gameType: "Doubles", terrain: "Misty" }), burns: false },
    { atk: "Garchomp", move: "dragon-claw", burns: false },
  ];
  for (const c of cases) {
    it(`${c.atk} ${c.move}: ${c.burns ? "later hits change" : "rolls unchanged"}`, () => {
      const a = { profile: find(c.atk), ability: c.ability ?? "Illuminate", item: c.item };
      const spicy = runBoth(a, { profile: find("Scovillain-Mega"), ability: "Spicy Spray" }, MOVES[c.move], c.field ?? DOUBLES)!;
      const plain = runBoth(a, { profile: find("Scovillain-Mega"), ability: "Illuminate" }, MOVES[c.move], c.field ?? DOUBLES)!;
      expect(spicy.expected).not.toBeNull();
      if (c.burns) expect(spicy.expected).not.toEqual(plain.expected);
      else expect(spicy.expected).toEqual(plain.expected);
      expect(spicy.got).toEqual(spicy.expected);
    });
  }
});

// Priority raised mid-turn by Showdown's onModifyPriority — Grassy Glide +1 for a
// grounded user in Grassy Terrain — is what Armor Tail / Queenly Majesty /
// Dazzling test. The library never raises it, so it lets Rillaboom's Grassy
// Glide (99% of its sets, in its own Grassy Surge) "hit" Armor Tail Farigiraf; in
// game it fails. Engine-only pins, plus one cross-check that the library blocks
// the same move once told its real priority. (Gale Wings' +1 is no longer
// mirrored either — since 2026-11-18 it reaches the blockers too; pinned in
// calc-data.test.ts, and the bake's stale rows are the documented exception in
// "baked KO benchmarks = the engine's verdicts".)
describe("priority the blockers see — Grassy Glide in Grassy Terrain", () => {
  const mon = (name: string, ability: string, extra: Partial<CalcPokemon> = {}) =>
    build(find(name), ability, undefined, extra).mine;
  const glide = moveToCalcMove(MOVES["grassy-glide"])!;
  const grassy = { gameType: "Doubles", terrain: "Grassy" } as const;

  it("Grassy Glide in Grassy Terrain fails into Armor Tail (Rillaboom into Farigiraf)", () => {
    const farigiraf = mon("Farigiraf", "Armor Tail");
    expect(computeDamage(mon("Rillaboom", "Grassy Surge"), farigiraf, glide, grassy).fails).toBe("Armor Tail blocks priority");
    // Priority 0 again with no terrain up, or from a user floating above it.
    expect(computeDamage(mon("Rillaboom", "Grassy Surge"), farigiraf, glide, { gameType: "Doubles" }).maxDamage).toBeGreaterThan(0);
    expect(computeDamage(mon("Rillaboom", "Grassy Surge", { item: "Air Balloon" }), farigiraf, glide, grassy).fails).toBeNull();
    // The library blocks it too once the move carries the game's +1.
    const r = build(find("Rillaboom"), "Grassy Surge", undefined);
    const f = build(find("Farigiraf"), "Armor Tail", undefined);
    const lib = new Move(GEN, "Grassy Glide", { overrides: { ...championsMoveOverrides(MOVES["grassy-glide"]), priority: 1 } as any });
    expect(calcDamage(r.calc, f.calc, lib, new Field({ gameType: "Doubles", terrain: "Grassy" }))?.[15] ?? 0).toBe(0);
  });

  it("Queenly Majesty blocks it the same way; other moves keep their priority", () => {
    expect(computeDamage(mon("Rillaboom", "Grassy Surge"), mon("Tsareena", "Queenly Majesty"), glide, grassy).fails)
      .toBe("Queenly Majesty blocks priority");
    expect(computeDamage(mon("Rillaboom", "Grassy Surge"), mon("Farigiraf", "Armor Tail"), moveToCalcMove(MOVES["wood-hammer"])!, grassy).fails)
      .toBeNull();
  });
});

describe("critical hits — always-crit moves", () => {
  // Same shape as the spread suite: `alwaysCrits` is a name list, so prove it
  // equals the library's `willCrit` over the WHOLE move index — a new
  // always-crit move can't slip in just because no meta mon samples it yet.
  // (The baked data can't stand in: PokeAPI's critRate serves Flower Trick as
  // 0, while Frost Breath and Storm Throw get 6.)
  it("flags exactly the moves @smogon/calc always crits", () => {
    const drift: string[] = [];
    const flagged: string[] = [];
    for (const meta of Object.values(MOVES) as MoveSummary[]) {
      let calcMove;
      try {
        calcMove = new Move(GEN, meta.displayName);
      } catch {
        continue;
      }
      if (alwaysCrits(meta.displayName)) flagged.push(meta.name);
      if (calcMove.isCrit !== alwaysCrits(meta.displayName)) {
        drift.push(`${meta.name}: ours=${alwaysCrits(meta.displayName)} calc=${calcMove.isCrit}`);
      }
    }
    expect(drift, `\n${drift.join("\n")}`).toEqual([]);
    // Non-vacuous: the three this format actually has are in the index.
    expect(flagged).toEqual(expect.arrayContaining(["frost-breath", "flower-trick", "storm-throw"]));
  });
});

// Knock Off's 1.5× hinges entirely on "is this item removable", and in this
// format the only un-removable item is a Mega Stone. `isMegaStone` decides that
// by name, so this pins the naming rule against the app's own item pool: an
// item ends in "-ite" (with an optional X/Y/Z form suffix) if and only if only
// Mega forms are ever seen holding it.
// (Champions invents its own stones — Chimechite, Scovillainite, Meganiumite —
// which @smogon/calc's item table doesn't know, so the data IS the oracle here.)
describe("isMegaStone — the un-knockable-item rule", () => {
  it("matches which items only Mega forms hold, across both brackets", () => {
    const holders = new Map<string, string[]>();
    for (const bracket of Object.values(competitive.brackets) as any[]) {
      for (const [slug, p] of Object.entries(bracket) as [string, any][]) {
        for (const it of p.items ?? []) {
          const list = holders.get(it.displayName) ?? [];
          list.push(p.smogonName ?? slug);
          holders.set(it.displayName, list);
        }
      }
    }
    expect(holders.size).toBeGreaterThan(50);

    const wrong: string[] = [];
    let stones = 0;
    for (const [item, mons] of holders) {
      const megaOnly = mons.every((m) => /-Mega|-Primal/.test(m));
      if (megaOnly) stones++;
      if (isMegaStone(item) !== megaOnly) {
        wrong.push(`${item}: isMegaStone=${isMegaStone(item)} but held by ${mons.slice(0, 3).join(", ")}`);
      }
    }
    expect(stones).toBeGreaterThan(20);
    expect(wrong, `\n${wrong.join("\n")}`).toEqual([]);
  });

  it("does not mistake Eviolite for a Mega Stone", () => {
    // The one selectable item that ends in "-ite" without being a stone; if it
    // were misread, Knock Off would silently lose its 1.5× against Eviolite users.
    expect(isMegaStone("Eviolite")).toBe(false);
    expect(isMegaStone(null)).toBe(false);
    expect(isMegaStone("Charizardite Y")).toBe(true);
    expect(isMegaStone("Metagrossite")).toBe(true);
  });

  // Air Balloon is the format's only ITEM-granted immunity (v1.2.0). Asserted
  // on the verdict rather than through the parity sweep because @smogon/calc
  // returns a bare 0 for an immune matchup, not a 16-roll array.
  it("Air Balloon makes the holder immune to Ground", () => {
    const find = (name: string) =>
      Object.values(master).find((p: any) => p.smogonName === name && !p.asForm) as any;
    const chomp = find("Garchomp");
    const lax = find("Kingambit");
    const eq = MOVES["earthquake"];
    if (!chomp || !lax || !eq) return;
    const move = moveToCalcMove(eq)!;
    const attacker = build(chomp, "Illuminate", undefined).mine;

    const balloon = computeDamage(attacker, build(lax, "Illuminate", "Air Balloon").mine, move, { gameType: "Doubles" as const });
    expect(balloon.immune, "Air Balloon should zero a Ground move").toBe(true);
    expect(balloon.maxDamage).toBe(0);

    // Same matchup without the balloon must still take real damage, so the
    // test can't pass by the move being a no-op for another reason.
    const bare = computeDamage(attacker, build(lax, "Illuminate", undefined).mine, move, { gameType: "Doubles" as const });
    expect(bare.immune).toBe(false);
    expect(bare.maxDamage).toBeGreaterThan(0);

    // …and the balloon must not blanket-block non-Ground moves.
    const rock = MOVES["rock-slide"];
    if (rock) {
      const rockRes = computeDamage(attacker, build(lax, "Illuminate", "Air Balloon").mine, moveToCalcMove(rock)!, { gameType: "Doubles" as const });
      expect(rockRes.immune, "Air Balloon should only stop Ground").toBe(false);
    }
  });

  // Pinned by hand rather than left to the pool test above: Z Mega Evolution
  // shipped in v1.2.0 (Reg M-C) but Smogon's first M-C stats month is 2026-09,
  // so until that data lands NO Z stone appears in the item pool and the sweep
  // would pass while the rule was wrong. It WAS wrong — the pattern stopped at
  // X/Y, so a Z stone read as removable and Knock Off took a bogus 1.5× against
  // a Z Mega holding its own stone. Same lesson as Body Press / Knock Off: a
  // move or item the current month doesn't sample is untested, not correct.
  it("treats the v1.2.0 Z Mega stones as un-knockable", () => {
    expect(isMegaStone("Lucarionite Z")).toBe(true);
    expect(isMegaStone("Garchompite Z")).toBe(true);
    expect(isMegaStone("Absolite Z")).toBe(true);
    // The plain Megas of the same three species keep working.
    expect(isMegaStone("Lucarionite")).toBe(true);
    expect(isMegaStone("Garchompite")).toBe(true);
    expect(isMegaStone("Absolite")).toBe(true);
  });
});

// The UI shows "Fails" + this reason instead of "No effect", so a trainer can
// tell "Steel Roller does nothing here" from "this target is immune". Parity
// above only proves the zeros; this pins the contract the verdict row reads.
describe("moves that fail outright", () => {
  const find = (name: string) =>
    Object.values(master).find((p: any) => p.smogonName === name && !p.asForm) as any;

  it("reports why, distinct from an immunity", () => {
    const a = find("Kingambit");
    const d = find("Incineroar");
    if (!a || !d) return;
    const atk = build(a, "Illuminate", undefined).mine;
    const def = build(d, "Illuminate", undefined).mine;
    const roller = moveToCalcMove(MOVES["steel-roller"])!;

    const flat = computeDamage(atk, def, roller, { gameType: "Doubles" });
    expect(flat.fails).toBe("needs a terrain up");
    expect(flat.immune).toBe(false);
    expect(flat.verdict.label).toBe("Fails");
    expect(flat.maxDamage).toBe(0);

    const up = computeDamage(atk, def, roller, { gameType: "Doubles", terrain: "Grassy" });
    expect(up.fails).toBeNull();
    expect(up.maxDamage).toBeGreaterThan(0);

    const fakeOut = moveToCalcMove(MOVES["fake-out"])!;
    const blocked = computeDamage(def, build(find("Garchomp") ?? a, "Illuminate", undefined).mine, fakeOut, {
      gameType: "Doubles", terrain: "Psychic",
    });
    expect(blocked.fails).toBe("Psychic Terrain blocks priority");
  });
});

// The name-keyed move tables in damage.ts (the baked data can't carry them) —
// each held to the library over the WHOLE move index, like `alwaysCrits`, so a
// move no ladder month samples still can't drift.
describe("name-keyed move tables — the whole move index vs @smogon/calc", () => {
  const known = (Object.values(MOVES) as MoveSummary[])
    .filter((m) => m.damageClass !== "status" && !!GEN.moves.get(toID(m.displayName) as any))
    .map((meta) => ({ meta, lib: new Move(GEN, meta.displayName) }));

  it("covers the index", () => {
    expect(known.length).toBeGreaterThan(300);
  });

  it("ignores-defense-stages = the library's `ignoreDefensive` (Darkest Lariat, Sacred Sword)", () => {
    const drift = known.filter(({ meta, lib }) => ignoresDefenseStages(meta.displayName) !== !!lib.ignoreDefensive);
    expect(drift.map(({ meta }) => meta.name)).toEqual([]);
    expect(known.filter(({ meta }) => ignoresDefenseStages(meta.displayName)).map(({ meta }) => meta.name).sort())
      .toEqual(["darkest-lariat", "sacred-sword"]);
  });

  it("Reckless moves = the library's `recoil || hasCrashDamage`", () => {
    const drift = known.filter(({ meta, lib }) => isRecklessMove(meta.displayName) !== (!!lib.recoil || lib.hasCrashDamage));
    expect(drift.map(({ meta }) => meta.name)).toEqual([]);
    // PokeAPI serves Wave Crash with no recoil and has no crash field at all.
    for (const n of ["wave-crash", "high-jump-kick", "axe-kick", "supercell-slam", "brave-bird"]) {
      expect(isRecklessMove(MOVES[n].displayName), n).toBe(true);
    }
  });

  it("Sheer Force's secondary-effect rule = the library's `secondaries` (bar Champions' Freeze-Dry)", () => {
    const drift = known
      .filter(({ meta, lib }) => hasSecondaryEffect(meta) !== !!lib.secondaries)
      .map(({ meta }) => meta.name);
    // The mod removes Freeze-Dry's freeze chance (`secondary: undefined`): no
    // secondary in Champions, so no Sheer Force boost. Everything else agrees.
    expect(drift).toEqual(["freeze-dry"]);
    expect(MOVES["freeze-dry"].ailment).toBeNull();
  });

  it("the user's own Atk/SpA drop = the library's `dropsStats` (bar Champions' Make It Rain −2)", () => {
    const drift = known
      .filter(({ meta, lib }) => selfAttackDrop(meta.displayName) !== (lib.dropsStats ?? 0))
      .map(({ meta, lib }) => `${meta.name}: ours=${selfAttackDrop(meta.displayName)} calc=${lib.dropsStats ?? 0}`);
    expect(drift.filter((d) => !d.startsWith("make-it-rain:"))).toEqual([]);
    if (MOVES["make-it-rain"]) expect(selfAttackDrop("Make It Rain")).toBe(2);
  });

  it("hit counts = the library's (with and without Skill Link)", () => {
    const a = build(find("Garchomp"), "Illuminate", undefined).mine;
    const sl = { ...a, ability: "Skill Link" };
    const d = build(find("Incineroar"), "Illuminate", undefined).mine;
    const drift: string[] = [];
    let multi = 0;
    for (const { meta, lib } of known) {
      const mine = moveToCalcMove(meta);
      if (!mine) continue;
      const libSL = new Move(GEN, meta.displayName, { ability: "Skill Link" as any });
      const field: CalcField = { gameType: "Doubles", ...libraryTargets(meta.name) };
      const ours = computeDamage(a, d, mine, field).hits;
      const oursSL = computeDamage(sl, d, mine, field).hits;
      if (lib.hits > 1) multi++;
      if (ours !== lib.hits || oursSL !== libSL.hits) drift.push(`${meta.name}: ours=${ours}/${oursSL} calc=${lib.hits}/${libSL.hits}`);
    }
    expect(multi).toBeGreaterThan(10);
    expect(drift).toEqual([]);
  }, SWEEP_TIMEOUT);
});

// Every Champions pool item that changes a damage roll: in the pool, offered by
// the Calc, and modelled exactly as the library rolls it — one pin per item, so
// no item depends on a ladder mon happening to hold it.
describe("Champions held items that change a roll — every one in the pool", () => {
  const pool = new Set((dataset as any).itemPool as string[]);
  const calcSrc = readFileSync(new URL("../components/Calc.tsx", import.meta.url), "utf8");
  const offered = new Set(
    [...(calcSrc.match(/const ITEMS = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  );
  const TYPE_BOOSTERS: Record<string, PokemonType> = {
    "Black Belt": "fighting", "Black Glasses": "dark", Charcoal: "fire", "Dragon Fang": "dragon",
    "Fairy Feather": "fairy", "Hard Stone": "rock", Magnet: "electric", "Metal Coat": "steel",
    "Miracle Seed": "grass", "Mystic Water": "water", "Never-Melt Ice": "ice", "Poison Barb": "poison",
    "Sharp Beak": "flying", "Silk Scarf": "normal", "Silver Powder": "bug", "Soft Sand": "ground",
    "Spell Tag": "ghost", "Twisted Spoon": "psychic",
  };
  const RESIST_BERRIES: Record<string, PokemonType> = {
    "Babiri Berry": "steel", "Charti Berry": "rock", "Chilan Berry": "normal", "Chople Berry": "fighting",
    "Coba Berry": "flying", "Colbur Berry": "dark", "Haban Berry": "dragon", "Kasib Berry": "ghost",
    "Kebia Berry": "poison", "Occa Berry": "fire", "Passho Berry": "water", "Payapa Berry": "psychic",
    "Rindo Berry": "grass", "Roseli Berry": "fairy", "Shuca Berry": "ground", "Tanga Berry": "bug",
    "Wacan Berry": "electric", "Yache Berry": "ice",
  };
  /** Every pool item that can change a roll the calc computes (Metronome needs consecutive uses — not an input). */
  const ROLL_ITEMS = [
    ...Object.keys(TYPE_BOOSTERS), ...Object.keys(RESIST_BERRIES),
    "Life Orb", "Expert Belt", "Normal Gem", "Muscle Band", "Wise Glasses", "Light Ball",
    "Choice Scarf", "Iron Ball", "Air Balloon", "Electric Seed", "Grassy Seed", "Psychic Seed", "Misty Seed",
  ];
  const mult = (type: PokemonType, types: readonly PokemonType[]) =>
    types.reduce((m, t) => m * (TYPE_CHART[type][t] ?? 1), 1);
  const pickMove = (type: PokemonType, category?: "physical" | "special") =>
    (Object.values(MOVES) as MoveSummary[]).find((m) =>
      m.type === type && !!m.power && (m.maxHits ?? 1) <= 1 && m.priority === 0 &&
      (!category || m.damageClass === category) && !!moveToCalcMove(m) &&
      !!GEN.moves.get(toID(m.displayName) as any) && !NO_ATE.has(m.name) && !isSpreadMove(m.target));
  const DEFENDERS = ["Incineroar", "Garchomp", "Kingambit", "Rillaboom", "Sylveon", "Pelipper", "Farigiraf",
    "Sneasler", "Archaludon", "Charizard", "Basculegion", "Gholdengo"];
  const typesOf = (name: string) => (GEN.species.get(toID(name) as any)!.types as string[]).map((t) => t.toLowerCase() as PokemonType);

  it("are all in Showdown's Champions pool and all offered by the Calc", () => {
    expect(ROLL_ITEMS.filter((n) => !pool.has(n))).toEqual([]);
    expect(offered.size).toBeGreaterThan(40);
    expect(ROLL_ITEMS.filter((n) => !offered.has(n))).toEqual([]);
  });

  for (const [item, type] of Object.entries(TYPE_BOOSTERS)) {
    it(`${item}: 1.2× on ${type} moves`, () => {
      const meta = pickMove(type);
      expect(meta, `a single-target ${type} move`).toBeDefined();
      const def = DEFENDERS.find((n) => mult(type, typesOf(n)) > 0)!;
      const a = { profile: find("Garchomp"), ability: "Illuminate" };
      const d = { profile: find(def), ability: "Illuminate" };
      const bare = runBoth(a, d, meta!)!;
      const held = runBoth({ ...a, item }, d, meta!)!;
      expect(held.expected).not.toEqual(bare.expected); // the library knows the item
      expect(held.got).toEqual(held.expected);
    });
  }

  for (const [item, type] of Object.entries(RESIST_BERRIES)) {
    it(`${item}: halves a ${type === "normal" ? "Normal" : "super-effective " + type} hit`, () => {
      const meta = pickMove(type);
      expect(meta, `a single-target ${type} move`).toBeDefined();
      const def = type === "normal"
        ? "Garchomp"
        : (Object.values(master) as any[]).map((p) => p.smogonName as string)
          .find((n) => !!n && !!GEN.species.get(toID(n) as any) && mult(type, typesOf(n)) > 1);
      expect(def, `a ladder mon weak to ${type}`).toBeDefined();
      const a = { profile: find("Garchomp"), ability: "Illuminate" };
      const bare = runBoth(a, { profile: find(def!), ability: "Illuminate" }, meta!)!;
      const held = runBoth(a, { profile: find(def!), ability: "Illuminate", item }, meta!)!;
      expect(held.expected![15]).toBeLessThan(bare.expected![15]);
      expect(held.got).toEqual(held.expected);
    });
  }

  for (const [item, category] of [["Muscle Band", "physical"], ["Wise Glasses", "special"]] as const) {
    it(`${item}: 1.1× (4505) on ${category} moves only`, () => {
      for (const cat of ["physical", "special"] as const) {
        const meta = pickMove("dragon", cat)!;
        const pair = runBoth({ profile: find("Garchomp"), ability: "Illuminate", item }, { profile: find("Incineroar"), ability: "Illuminate" }, meta)!;
        const bare = runBoth({ profile: find("Garchomp"), ability: "Illuminate" }, { profile: find("Incineroar"), ability: "Illuminate" }, meta)!;
        if (cat === category) expect(pair.expected).not.toEqual(bare.expected);
        else expect(pair.expected).toEqual(bare.expected);
        expect(pair.got).toEqual(pair.expected);
      }
    });
  }
});

describe("KO verdict labels", () => {
  // Rolls across the real meta, abilities and items on.
  const results = (() => {
    const out: ReturnType<typeof computeDamage>[] = [];
    const profiles = (Object.values(master) as any[])
      .filter((p) => !p.asForm && p.spread && p.smogonName)
      .sort((a, b) => b.usagePct - a.usagePct);
    for (const ap of profiles.slice(0, 30)) {
      const moves = Object.keys(ap.moveUsage).map((s) => MOVES[s]).filter((m) => !!m && !!moveToCalcMove(m)).slice(0, 5);
      for (const meta of moves) {
        for (const dp of profiles.slice(0, 16)) {
          try {
            const a = build(ap, "Illuminate", ap.items?.[0]?.displayName).mine;
            const d = build(dp, "Illuminate", dp.items?.[0]?.displayName).mine;
            out.push(computeDamage(a, d, moveToCalcMove(meta)!, { gameType: "Doubles" }));
          } catch {
            // a species the library can't build
          }
        }
      }
    }
    return out;
  })();

  it("never prints a range whose two ends are the same label (it printed '4+ HKO–4+ HKO')", () => {
    expect(results.length).toBeGreaterThan(1000);
    const doubled = results.map((r) => r.verdict.label).filter((l) => /^(.+)–\1$/.test(l));
    expect(doubled).toEqual([]);
  });

  it("collapses a 5HKO–7HKO-style spread into one guaranteed '4+ HKO'", () => {
    // (A user-fainting move has one use — "No KO", never "4+ HKO".)
    const wide = results.filter((r) => r.maxDamage > 0 && !r.move.userFaints && Math.ceil(r.hp / r.maxDamage) >= 4 &&
      Math.ceil(r.hp / r.minDamage) > Math.ceil(r.hp / r.maxDamage));
    expect(wide.length).toBeGreaterThan(0);
    for (const r of wide) expect(r.verdict).toMatchObject({ label: "4+ HKO", guaranteed: true });
  });

  it("keeps a real range as a range", () => {
    const ranged = results.filter((r) => r.verdict.label.includes("–"));
    expect(ranged.length).toBeGreaterThan(0);
    for (const r of ranged) {
      const [lo, hi] = r.verdict.label.split("–");
      expect(lo).not.toBe(hi);
      expect(r.verdict.guaranteed).toBe(false);
    }
  });
});

// The baked KO benchmarks ("Hyper Voice OHKOs X, 2HKOs Y") are computed at build
// time by @smogon/calc (scripts/generate-competitive.mjs) — with the Champions-
// original abilities fed through the same stand-ins as `championsProxy`. This
// recomputes every baked row with the ENGINE the calc ships, from the same
// inputs (top ability, top item, ladder spread, top 16 targets), so the two can
// never disagree: a benchmark the in-app calc wouldn't reproduce turns this red.
describe("baked KO benchmarks = the engine's verdicts", () => {
  it("every master benchmark row reproduces with computeDamage", () => {
    const ABILITY_DISPLAY = new Map<string, string>();
    for (const p of (dataset as any).pokemon) {
      for (const f of [p, ...(p.forms ?? [])]) for (const a of f.abilities ?? []) ABILITY_DISPLAY.set(toID(a.name), a.displayName);
    }
    const topAbility = (p: any): string => {
      const best = Object.entries((p.abilityUsage ?? {}) as Record<string, number>).sort((x, y) => y[1] - x[1])[0];
      return best ? ABILITY_DISPLAY.get(best[0]) ?? "Illuminate" : "Illuminate";
    };
    const profiles = (Object.values(master) as any[]).filter((p) => !p.asForm && p.spread);
    const targets = [...profiles].sort((a, b) => b.usagePct - a.usagePct).slice(0, 16);
    const drift: string[] = [];
    let rows = 0;
    let galeWingsBlocks = 0;
    for (const ap of profiles) {
      for (const row of ap.benchmarks ?? []) {
        const meta = MOVES[row.move];
        const move = meta && moveToCalcMove(meta);
        expect(move, `${ap.smogonName} ${row.move}`).toBeTruthy();
        const attacker = build(ap, topAbility(ap), ap.items?.[0]?.displayName).mine;
        const ohko: string[] = [];
        const two: string[] = [];
        for (const tp of targets) {
          if (tp.smogonName === ap.smogonName) continue;
          // The bake rolls Dragon Darts' two darts into one target (the library's
          // only reading) — the engine's one-foe case (see `libraryTargets`).
          const benchField: CalcField = { gameType: "Doubles", ...libraryTargets(meta.displayName) };
          const target = build(tp, topAbility(tp), tp.items?.[0]?.displayName).mine;
          let r = computeDamage(attacker, target, move!, benchField);
          // INTENDED DIVERGENCE: a full-HP Gale Wings Flying move is +1, so Armor
          // Tail / Queenly Majesty / Dazzling stop it (Talonflame's Brave Bird into
          // Farigiraf). The bake still mirrors the library, which never raises the
          // priority, so it counts the hit — reproduce the bake's number with the
          // blocker's ability neutral until generate-competitive applies the rule.
          if (r.fails?.endsWith("blocks priority") && toID(attacker.ability ?? "") === "galewings") {
            galeWingsBlocks++;
            r = computeDamage(attacker, { ...target, ability: "Illuminate" }, move!, benchField);
          }
          if (r.minDamage >= r.maxHp) ohko.push(tp.smogonName);
          else if (r.minDamage * 2 >= r.maxHp) two.push(tp.smogonName);
        }
        rows++;
        if (ohko.length !== row.ohkoCount || two.length !== row.twoCount ||
            JSON.stringify(ohko.slice(0, 3)) !== JSON.stringify(row.ohko) || JSON.stringify(two.slice(0, 3)) !== JSON.stringify(row.two)) {
          drift.push(`${ap.smogonName} ${row.move}: baked ${row.ohkoCount}/${row.twoCount} engine ${ohko.length}/${two.length}`);
        }
      }
    }
    expect(rows).toBeGreaterThan(500);
    // 3 rows on the 2026-11 bake (Talonflame into the Armor Tail / Queenly Majesty targets).
    expect(galeWingsBlocks, "the Gale Wings exception must stay narrow").toBeLessThanOrEqual(6);
    expect(drift, `\n${drift.slice(0, 20).join("\n")}`).toEqual([]);
  }, SWEEP_TIMEOUT);
});
