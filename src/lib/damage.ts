/**
 * Client-side Gen-9 damage engine for Champions (doubles, Lv 50, 31 IVs, no Tera).
 *
 * This is a faithful port of the single formula `@smogon/calc` runs in
 * `dist/mechanics/gen789.js` — base damage, the bp/attack/defense/final
 * modifier chains, `pokeRound`, and the 16-step roll — restricted to the
 * mechanics that actually occur in this format. We deliberately do NOT ship
 * `@smogon/calc` (it drags a ~2.6 MB national-dex data layer). Instead the
 * library stays a dev-only dependency that powers the build-time KO benchmarks
 * AND acts as the golden-test oracle in `damage.test.ts`: every number this
 * module produces is checked to match the real library.
 *
 * Stats come from `lv50Stats` (EV-space), so the calc's numbers are identical
 * to the app's baked benchmarks and opponent Speed reads. The UI edits Stat
 * Points and converts to EVs via `stat-points.ts` before calling in.
 */

import { lv50Stats } from "./battle";
import { defensiveMultiplier } from "./type-chart";
import { isSpreadMove } from "./spread";
import type {
  CompetitiveSpread,
  DamageClass,
  EvStat,
  MoveSummary,
  PokemonStats,
  PokemonType,
} from "./types";

// --- fixed-point helpers, matching @smogon/calc exactly --------------------------

const pokeRound = (n: number): number => (n % 1 > 0.5 ? Math.ceil(n) : Math.floor(n));

/** chainMods([m1,m2,…]) in Q12 (4096) fixed point, clamped like the library. */
function chainMods(mods: number[], lower: number, upper: number): number {
  let m = 4096;
  for (const mod of mods) if (mod !== 4096) m = (m * mod + 2048) >> 12;
  return Math.max(Math.min(m, upper), lower);
}

/** Stat after a boost stage (−6…+6), Gen 3+ table. */
function modifiedStat(stat: number, stage: number): number {
  const table: [number, number][] = [
    [2, 8], [2, 7], [2, 6], [2, 5], [2, 4], [2, 3], [2, 2],
    [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2],
  ];
  const [num, den] = table[6 + Math.max(-6, Math.min(6, stage))];
  return Math.floor((stat * num) / den);
}

const stripId = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// --- public input/output shapes --------------------------------------------------

export type BoostStat = "atk" | "def" | "spa" | "spd" | "spe";
export type Status = "brn" | "par" | "psn" | "tox" | "slp" | "frz" | null;
export type Weather = "Sun" | "Rain" | "Sand" | "Snow" | null;

/** One combatant, resolved from the roster + the trainer's edits. */
export interface CalcPokemon {
  /** Display/Smogon name — only used for descriptions and golden-test parity. */
  name: string;
  types: PokemonType[];
  /** Base (species) stats; Lv50 stats are derived here via `lv50Stats`. */
  baseStats: PokemonStats;
  ability?: string | null;
  item?: string | null;
  nature?: string;
  /** EV-space spread (the UI converts Stat Points → EVs before this). */
  evs?: Partial<Record<EvStat, number>>;
  boosts?: Partial<Record<BoostStat, number>>;
  status?: Status;
  /** Current HP as a % of max (default 100) — drives Multiscale + survival. */
  curHpPct?: number;
  /** Weight in kg — for weight-based moves (Grass Knot, Heavy Slam, …). */
  weightKg?: number;
}

/** A damaging move, reduced to what the formula needs. */
export interface CalcMove {
  name: string;
  type: PokemonType;
  category: "physical" | "special";
  basePower: number;
  target?: string | null;
  flags?: string[];
  /** Has a secondary effect (drives Sheer Force). */
  hasSecondary?: boolean;
  minHits?: number | null;
  maxHits?: number | null;
  priority?: number;
  /** Variable-power move id (Grass Knot, Heavy Slam, …); BP resolved at compute time. */
  variablePower?: string;
}

export interface CalcField {
  gameType?: "Doubles" | "Singles";
  weather?: Weather;
  /** Attacker's side. */
  helpingHand?: boolean;
  /** Defender's side. */
  reflect?: boolean;
  lightScreen?: boolean;
  auroraVeil?: boolean;
  friendGuard?: boolean;
  isCritical?: boolean;
}

export interface KoVerdict {
  /** e.g. "OHKO", "2HKO", "3HKO", "4+ HKO". */
  label: string;
  /** Guaranteed (even the worst roll gets there). */
  guaranteed: boolean;
  /** Chance (%) the move KOs in ONE hit, from the 16-roll spread. */
  ohkoChance: number;
}

export interface DamageResult {
  /** 16 damage rolls (already summed over multi-hit), ascending. */
  damage: number[];
  minDamage: number;
  maxDamage: number;
  /** Defender's CURRENT HP (max × curHpPct), the KO target. */
  hp: number;
  maxHp: number;
  minPct: number;
  maxPct: number;
  typeEffectiveness: number;
  immune: boolean;
  /** Number of hits folded into each roll (1 for normal moves). */
  hits: number;
  verdict: KoVerdict;
}

/** Real Lv50 stats as {hp,atk,def,spa,spd,spe} from base stats + an EV spread. */
function rawStats(mon: CalcPokemon): Record<BoostStat | "hp", number> {
  const spread: CompetitiveSpread = { nature: mon.nature ?? "Hardy", evs: mon.evs ?? {} };
  const s = lv50Stats(mon.baseStats, spread);
  return {
    hp: s.hp, atk: s.attack, def: s.defense,
    spa: s.specialAttack, spd: s.specialDefense, spe: s.speed,
  };
}

const has = (name: string | null | undefined, ...opts: string[]): boolean =>
  name != null && opts.some((o) => stripId(o) === stripId(name));

/** Special moves that strike the target's physical Defense instead of Sp. Def. */
const PSYSHOCK_MOVES = new Set(["psyshock", "psystrike", "secretsword"]);

/** Variable-power moves whose base power the engine computes from weight/speed. */
export const VARIABLE_MOVES = new Set([
  "grassknot", "lowkick", "heavyslam", "heatcrash", "gyroball", "electroball",
]);

/** Grass Knot / Low Kick: base power by the TARGET's weight (kg). */
function weightBP(kg: number): number {
  if (kg >= 200) return 120;
  if (kg >= 100) return 100;
  if (kg >= 50) return 80;
  if (kg >= 25) return 60;
  if (kg >= 10) return 40;
  return 20;
}

/** Heavy Slam / Heat Crash: base power by the attacker/target weight ratio. */
function weightRatioBP(attackerKg: number, defenderKg: number): number {
  const r = defenderKg > 0 ? attackerKg / defenderKg : 5;
  if (r >= 5) return 120;
  if (r >= 4) return 100;
  if (r >= 3) return 80;
  if (r >= 2) return 60;
  return 40;
}

/** Resolve a variable-power move's base power from the two combatants' stats. */
function variableBasePower(
  id: string,
  aWeight: number,
  dWeight: number,
  aSpeed: number,
  dSpeed: number,
): number {
  switch (id) {
    case "grassknot":
    case "lowkick":
      return weightBP(dWeight);
    case "heavyslam":
    case "heatcrash":
      return weightRatioBP(aWeight, dWeight);
    case "gyroball":
      if (aSpeed <= 0) return 1;
      return Math.min(150, Math.floor((25 * dSpeed) / aSpeed) + 1);
    case "electroball": {
      if (dSpeed <= 0) return 40;
      const r = Math.floor(aSpeed / dSpeed);
      return r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40;
    }
    default:
      return 1;
  }
}

/** Move types a defender ability makes it flat-out immune to (→ effectiveness 0). */
const IMMUNITY: Record<string, PokemonType> = {
  levitate: "ground",
  eartheater: "ground",
  flashfire: "fire",
  wellbakedbody: "fire",
  waterabsorb: "water",
  stormdrain: "water",
  dryskin: "water",
  voltabsorb: "electric",
  lightningrod: "electric",
  motordrive: "electric",
  sapsipper: "grass",
};

/**
 * Type effectiveness including defender ability immunities (Levitate, Flash
 * Fire, …) and Wonder Guard. Ability-based HALVING (Thick Fat, Multiscale, …)
 * lives in the mod chains below, exactly as `@smogon/calc` partitions it — so
 * this returns pure type math plus hard immunities only.
 */
function typeEffectiveness(move: CalcMove, defender: CalcPokemon): number {
  let eff = defensiveMultiplier(move.type, defender.types);
  // Freeze-Dry is always super-effective on Water (overriding Ice's 0.5×).
  if (stripId(move.name) === "freezedry") {
    for (const t of defender.types) if (t === "water") eff *= 4; // 0.5 → 2
  }
  const ab = defender.ability ? stripId(defender.ability) : "";
  if (ab && IMMUNITY[ab] === move.type) eff = 0;
  if (ab === "wonderguard" && eff <= 1) eff = 0;
  return eff;
}

/** How many hits to fold into one roll (multi-hit moves). */
function hitCount(move: CalcMove): number {
  const min = move.minHits ?? 1;
  const max = move.maxHits ?? 1;
  if (max <= 1) return 1;
  return min === max ? min : 3; // 2–5 hit moves average ~3
}

/**
 * Compute a full damage roll of `move` from `attacker` into `defender` under
 * `field`. Returns the 16-roll array, %s, and a KO verdict.
 */
export function computeDamage(
  attacker: CalcPokemon,
  defender: CalcPokemon,
  move: CalcMove,
  field: CalcField = {},
): DamageResult {
  const gameType = field.gameType ?? "Doubles";
  const isDoubles = gameType !== "Singles";
  const crit = !!field.isCritical;

  const aStats = rawStats(attacker);
  const dStats = rawStats(defender);
  const maxHp = dStats.hp;
  const hp = Math.max(1, Math.floor((maxHp * (defender.curHpPct ?? 100)) / 100));

  const eff = typeEffectiveness(move, defender);
  const hits = hitCount(move);

  if (eff === 0) {
    return {
      damage: new Array(16).fill(0), minDamage: 0, maxDamage: 0, hp, maxHp,
      minPct: 0, maxPct: 0, typeEffectiveness: 0, immune: true, hits,
      verdict: { label: "No effect", guaranteed: false, ohkoChance: 0 },
    };
  }

  const physical = move.category === "physical";

  // --- base power ---------------------------------------------------------------
  let bp = move.basePower;
  if (move.variablePower) {
    bp = variableBasePower(
      move.variablePower,
      attacker.weightKg ?? 0,
      defender.weightKg ?? 0,
      aStats.spe,
      dStats.spe,
    );
  }
  const bpMods: number[] = [];
  // Acrobatics doubles when the user is holding no item.
  if (has(move.name, "Acrobatics") && !attacker.item) bpMods.push(8192);
  if (field.helpingHand) bpMods.push(6144);
  if (has(attacker.ability, "Technician") && bp <= 60) bpMods.push(6144);
  if (has(attacker.ability, "Sheer Force") && move.hasSecondary) bpMods.push(5325);
  else if (has(attacker.ability, "Tough Claws") && move.flags?.includes("contact")) bpMods.push(5325);
  bp = Math.max(1, pokeRound((bp * chainMods(bpMods, 41, 2097152)) / 4096));

  // --- attack stat --------------------------------------------------------------
  // Foul Play uses the DEFENDER's Attack stat (+ its boosts); the attacker's
  // own abilities/items (Choice Band, Guts, …) still apply via the mod chain.
  const atkStat: BoostStat = physical ? "atk" : "spa";
  const foulPlay = physical && has(move.name, "Foul Play");
  let attack = (foulPlay ? dStats : aStats)[atkStat];
  const atkBoost = (foulPlay ? defender.boosts : attacker.boosts)?.[atkStat] ?? 0;
  if (atkBoost !== 0 && !has(defender.ability, "Unaware")) attack = modifiedStat(attack, atkBoost);
  const atMods: number[] = [];
  if (has(attacker.ability, "Huge Power", "Pure Power") && physical) atMods.push(8192);
  else if (has(attacker.ability, "Water Bubble") && move.type === "water") atMods.push(8192);
  if (has(attacker.ability, "Guts") && attacker.status && physical) atMods.push(6144);
  if ((has(defender.ability, "Thick Fat") && (move.type === "fire" || move.type === "ice")) ||
      (has(defender.ability, "Water Bubble") && move.type === "fire") ||
      (has(defender.ability, "Purifying Salt") && move.type === "ghost") ||
      (has(defender.ability, "Heatproof") && move.type === "fire")) {
    atMods.push(2048);
  }
  if (!crit && ((has(attacker.item, "Choice Band") && physical) ||
      (has(attacker.item, "Choice Specs") && !physical))) atMods.push(6144);
  attack = Math.max(1, pokeRound((attack * chainMods(atMods, 410, 131072)) / 4096));

  // --- defense stat -------------------------------------------------------------
  // Psyshock / Psystrike / Secret Sword are Special moves that hit Defense.
  const hitsPhysicalDef = physical || PSYSHOCK_MOVES.has(stripId(move.name));
  const defStat: BoostStat = hitsPhysicalDef ? "def" : "spd";
  let defense = dStats[defStat];
  const defBoost = defender.boosts?.[defStat] ?? 0;
  // A crit ignores the defender's positive defense boosts.
  if (defBoost !== 0 && !(crit && defBoost > 0) && !has(attacker.ability, "Unaware")) {
    defense = modifiedStat(defense, defBoost);
  }
  if (field.weather === "Sand" && defender.types.includes("rock") && !hitsPhysicalDef) {
    defense = pokeRound((defense * 3) / 2);
  }
  if (field.weather === "Snow" && defender.types.includes("ice") && hitsPhysicalDef) {
    defense = pokeRound((defense * 3) / 2);
  }
  const dfMods: number[] = [];
  if (has(defender.item, "Eviolite") || (!hitsPhysicalDef && has(defender.item, "Assault Vest"))) dfMods.push(6144);
  else if (has(defender.item, "Fur Coat") && hitsPhysicalDef) dfMods.push(8192);
  defense = Math.max(1, pokeRound((defense * chainMods(dfMods, 410, 131072)) / 4096));

  // --- base damage + spread/weather/crit ---------------------------------------
  let base = Math.floor(Math.floor((Math.floor((2 * 50) / 5 + 2) * bp * attack) / defense) / 50 + 2);
  if (isDoubles && isSpreadMove(move.target)) base = pokeRound((base * 3072) / 4096);
  if (field.weather === "Sun") {
    if (move.type === "fire") base = pokeRound((base * 6144) / 4096);
    else if (move.type === "water") base = pokeRound((base * 2048) / 4096);
  } else if (field.weather === "Rain") {
    if (move.type === "water") base = pokeRound((base * 6144) / 4096);
    else if (move.type === "fire") base = pokeRound((base * 2048) / 4096);
  }
  if (crit) base = Math.floor(base * 1.5);

  // --- STAB ---------------------------------------------------------------------
  let stabMod = 4096;
  if (attacker.types.includes(move.type)) {
    stabMod += 2048;
    if (has(attacker.ability, "Adaptability")) stabMod += 2048;
  }

  // --- burn ---------------------------------------------------------------------
  const isBurned = attacker.status === "brn" && physical &&
    !has(attacker.ability, "Guts") && !has(move.name, "Facade");

  // --- final mods ---------------------------------------------------------------
  const finalMods: number[] = [];
  const screen = isDoubles ? 2732 : 2048;
  if (field.reflect && physical && !crit && !field.auroraVeil) finalMods.push(screen);
  else if (field.lightScreen && !physical && !crit && !field.auroraVeil) finalMods.push(screen);
  if (field.auroraVeil && !crit) finalMods.push(screen);
  if (has(attacker.ability, "Neuroforce") && eff > 1) finalMods.push(5120);
  else if (has(attacker.ability, "Tinted Lens") && eff < 1) finalMods.push(8192);
  if (has(defender.ability, "Multiscale", "Shadow Shield") && (defender.curHpPct ?? 100) >= 100) {
    finalMods.push(2048);
  }
  if (has(defender.ability, "Fluffy") && move.flags?.includes("contact")) finalMods.push(2048);
  else if (has(defender.ability, "Ice Scales") && !physical) finalMods.push(2048);
  if (has(defender.ability, "Solid Rock", "Filter", "Prism Armor") && eff > 1) finalMods.push(3072);
  if (field.friendGuard) finalMods.push(3072);
  if (has(defender.ability, "Fluffy") && move.type === "fire") finalMods.push(8192);
  if (has(attacker.item, "Expert Belt") && eff > 1) finalMods.push(4915);
  else if (has(attacker.item, "Life Orb")) finalMods.push(5324);
  const finalMod = chainMods(finalMods, 41, 131072);

  // --- roll (16 steps, 85…100), summed over multi-hit --------------------------
  const damage: number[] = [];
  for (let i = 0; i < 16; i++) {
    let d = Math.floor((base * (85 + i)) / 100);
    if (stabMod !== 4096) d = (d * stabMod) / 4096;
    d = Math.floor(pokeRound(d) * eff);
    if (isBurned) d = Math.floor(d / 2);
    d = pokeRound(Math.max(1, (d * finalMod) / 4096));
    damage.push(d * hits);
  }
  damage.sort((a, b) => a - b);

  const minDamage = damage[0];
  const maxDamage = damage[15];

  return {
    damage,
    minDamage,
    maxDamage,
    hp,
    maxHp,
    minPct: (minDamage / hp) * 100,
    maxPct: (maxDamage / hp) * 100,
    typeEffectiveness: eff,
    immune: false,
    hits,
    verdict: verdictOf(damage, hp),
  };
}

/** Turn a 16-roll damage array + target HP into a KO verdict. */
function verdictOf(damage: number[], hp: number): KoVerdict {
  const min = damage[0];
  const max = damage[15];
  if (max <= 0) return { label: "No effect", guaranteed: false, ohkoChance: 0 };
  const ohkoChance = (damage.filter((d) => d >= hp).length / damage.length) * 100;
  // Guaranteed hits-to-KO uses the worst roll; possible uses the best.
  const guaranteedHits = Math.ceil(hp / min);
  const possibleHits = Math.ceil(hp / max);
  const label = (n: number) => (n <= 1 ? "OHKO" : n >= 4 ? "4+ HKO" : `${n}HKO`);
  if (guaranteedHits === possibleHits) {
    return { label: label(guaranteedHits), guaranteed: true, ohkoChance };
  }
  return { label: `${label(possibleHits)}–${label(guaranteedHits)}`, guaranteed: false, ohkoChance };
}

/**
 * Reduce a full {@link MoveSummary} to the calc's move shape. Returns null for
 * status moves and variable-power moves (Grass Knot, Heavy Slam, …) the engine
 * can't yet model — the UI shows those as "not calculated" rather than guessing.
 */
export function moveToCalcMove(m: Pick<MoveSummary,
  "displayName" | "type" | "damageClass" | "power" | "target" | "flags" |
  "ailment" | "ailmentChance" | "statChance" | "statChanges" | "flinchChance" |
  "minHits" | "maxHits" | "priority">): CalcMove | null {
  const cls: DamageClass = m.damageClass;
  if (cls === "status") return null;
  const category = cls === "physical" ? "physical" : "special";
  // Variable-power moves (Grass Knot, Heavy Slam, …) carry power: null; the ones
  // we can model resolve their BP at compute time. Everything else with null
  // power (Counter, Fissure, Endeavor, Fling, …) is genuinely not calculable.
  if (!m.power) {
    const id = stripId(m.displayName);
    if (!VARIABLE_MOVES.has(id)) return null;
    return {
      name: m.displayName, type: m.type, category, basePower: 0, variablePower: id,
      target: m.target, flags: m.flags ?? [], hasSecondary: false,
      minHits: m.minHits, maxHits: m.maxHits, priority: m.priority,
    };
  }
  const hasSecondary =
    (m.ailment != null && m.ailmentChance > 0) ||
    (m.statChance > 0 && (m.statChanges?.length ?? 0) > 0) ||
    m.flinchChance > 0;
  return {
    name: m.displayName,
    type: m.type,
    category,
    basePower: m.power,
    target: m.target,
    flags: m.flags ?? [],
    hasSecondary,
    minHits: m.minHits,
    maxHits: m.maxHits,
    priority: m.priority,
  };
}
