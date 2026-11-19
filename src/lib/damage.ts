/**
 * Client-side Gen-9 damage engine for Champions (doubles, Lv 50, 31 IVs, no Tera).
 *
 * This is a faithful port of the single formula `@smogon/calc` runs in
 * `src/mechanics/gen789.ts` — the "Initial" input rewrites (Cloud Nine, Klutz,
 * Seeds, Mold Breaker, -ate type changes…), base power, the bp/attack/defense/
 * final modifier chains, `pokeRound`, the 16-step roll and the per-hit loop of
 * multi-hit moves / Parental Bond — restricted to the mechanics that actually
 * occur in this format. We deliberately do NOT ship `@smogon/calc` (it drags a
 * ~2.6 MB national-dex data layer). Instead the library stays a dev-only
 * dependency that powers the build-time KO benchmarks AND acts as the
 * golden-test oracle in `damage.test.ts`: every number this module produces is
 * checked to match the real library.
 *
 * Champions-ORIGINAL abilities the library has never heard of (Dragonize, Fire
 * Mane, Mega Sol, Aura Guard, Eelevate, Spicy Spray — Piercing Drill changes no
 * damage roll) are ported from Pokémon Showdown's `champions` mod at the pinned
 * commit (`scripts/showdown-data.mjs`); each one's test oracle is the library
 * ability Showdown implements it identically to (see `damage.test.ts`). Spicy
 * Spray's burn lands AFTER a hit, so it only moves a multi-hit / Parental Bond
 * user's later hits (its oracle: the library's own per-hit rolls, burned from
 * hit 2).
 *
 * Deliberately NOT modelled — state the calc has no input for, exactly where the
 * library also needs a flag it defaults off (`abilityOn`, `alliesFainted`, gender):
 * Supreme Overlord (fainted allies), Rivalry (genders), Flash Fire's boost (needs
 * a Fire hit first), Stakeout (target just switched in), Plus/Minus (an ally's
 * ability), Unburden / Slow Start, Intimidate & Defiant/Competitive (use the
 * boost controls), Lash Out (stats lowered THIS turn — the library never doubles
 * it either), the Metronome item (consecutive uses), Protect (so Unseen Fist /
 * Piercing Drill's ¼-through-Protect never applies) and crit-stage items/abilities
 * (Scope Lens, Leek, Super Luck raise a CHANCE; only guaranteed crits are rolled).
 *
 * Stats come from `lv50Stats` (EV-space), so the calc's numbers are identical
 * to the app's baked benchmarks and opponent Speed reads. The UI edits Stat
 * Points and converts to EVs via `stat-points.ts` before calling in.
 */

import { lv50Stats } from "./battle";
import { TYPE_CHART } from "./type-chart";
import { isSpreadMove, SPREAD_DENOMINATOR, SPREAD_NUMERATOR } from "./spread";
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
const clampStage = (n: number): number => Math.max(-6, Math.min(6, n));

// --- public input/output shapes --------------------------------------------------

export type BoostStat = "atk" | "def" | "spa" | "spd" | "spe";
export type Status = "brn" | "par" | "psn" | "tox" | "slp" | "frz" | null;
export type Weather = "Sun" | "Rain" | "Sand" | "Snow" | null;
export type Terrain = "Electric" | "Grassy" | "Psychic" | "Misty" | null;

/** One combatant, resolved from the roster + the trainer's edits. */
export interface CalcPokemon {
  /**
   * BATTLE IDENTITY — the canonical Showdown species name of the form being
   * calculated (`CalcForm.battleName`), never the name of the ladder set a page
   * borrows. The species-keyed rules read it EXACTLY: Castform's Forecast,
   * Pikachu's Light Ball, Paldean Tauros' Raging Bull. (Until 2026-11-18 the
   * calc passed the LADDER name: Kantonian Tauros, whose Master+ data is
   * borrowed from Tauros-Paldea-Aqua, fought as it — a Water Raging Bull that
   * hit Gengar — and Castform, with no ladder entry, passed the slug "castform",
   * so Forecast never fired.)
   */
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
  /** Current HP as a % of max (default 100) — drives Multiscale, Blaze & co.,
   *  Eruption / Water Spout / Flail / Hard Press, and survival. */
  curHpPct?: number;
  /** Weight in kg — for weight-based moves (Grass Knot, Heavy Slam, …). */
  weightKg?: number;
  /**
   * Stance Change (Aegislash): the forme it ATTACKS in. Showdown's
   * `onModifyMove` switches Aegislash to Blade Forme before any damaging move
   * resolves, so whichever forme the trainer selected, its hits roll with
   * Blade's stats; DEFENDING it keeps the selected forme. Read only while the
   * ability is Stance Change. (`CalcForm.attacksAs`.)
   */
  attackForm?: { name: string; types: PokemonType[]; baseStats: PokemonStats; weightKg?: number };
}

/** A damaging move, reduced to what the formula needs. */
export interface CalcMove {
  name: string;
  type: PokemonType;
  category: "physical" | "special";
  basePower: number;
  target?: string | null;
  flags?: string[];
  /** Has a secondary effect (drives Sheer Force) — see {@link hasSecondaryEffect}. */
  hasSecondary?: boolean;
  minHits?: number | null;
  maxHits?: number | null;
  priority?: number;
  /** Variable-power / fixed-damage move id (Grass Knot, Seismic Toss, …); resolved at compute time. */
  variablePower?: string;
}

export interface CalcField {
  gameType?: "Doubles" | "Singles";
  /**
   * Only ONE target is left for a spread move to hit (the other foe has
   * fainted / isn't out). The ×0.75 spread reduction is keyed on the move
   * actually hitting 2+ targets, so this turns it off — and NOTHING else
   * (well: Parental Bond, which skips spread hits, then applies — as in game).
   *
   * Do not model this by flipping `gameType` to "Singles": that also swaps the
   * screen modifier (2732 → 2048) and would silently change Reflect/Light
   * Screen math. No effect on single-target moves — except Dragon Darts, which
   * then lands BOTH darts. Overrides `attackerSide` / `defenderSide`; the Calc
   * UI passes the per-side counts instead (each direction its own).
   */
  singleTarget?: boolean;
  /**
   * How many Pokémon are on the field on each SIDE (1 or 2; default 2). They
   * decide how many targets a move really hits ({@link targetsHit}):
   * `all-opponents` → the DEFENDER's side; `all-other-pokemon` (Earthquake) →
   * the defender's side + the attacker's own ally; Dragon Darts → one dart per
   * foe, so two foes take ONE dart each and a lone foe takes both. Each
   * direction of the calc passes its own pair, so a mon alone on its side takes
   * full-power Rock Slides while its partner-backed foe still takes ×0.75.
   * `singleTarget: true` overrides both to "exactly one target".
   */
  attackerSide?: number;
  defenderSide?: number;
  /** Tailwind on the attacker's / defender's side: ×2 Speed (first in the speed chain, as the library chains it). */
  attackerTailwind?: boolean;
  defenderTailwind?: boolean;
  /** Trick Room — turn order only ({@link turnOrder}); no damage roll reads it. */
  trickRoom?: boolean;
  weather?: Weather;
  /**
   * Active terrain — every damage effect @smogon/calc models, pinned in
   * damage.test.ts: 1.3× (5325) on a GROUNDED attacker's matching Electric/
   * Grass/Psychic move; Misty halving Dragon moves (and Grassy halving
   * Earthquake/Bulldoze) into a grounded target; Psychic Terrain blocking
   * priority moves into a grounded target; Steel Roller FAILING with none up;
   * the terrain-keyed moves (Expanding Force, Rising Voltage, Terrain Pulse,
   * Misty Explosion); a matching Seed's +1 Def/SpD; Grass Pelt; Surge Surfer.
   */
  terrain?: Terrain;
  /** Attacker's side. */
  helpingHand?: boolean;
  /** Defender's side. */
  reflect?: boolean;
  lightScreen?: boolean;
  auroraVeil?: boolean;
  friendGuard?: boolean;
  /**
   * Force a critical hit (no UI control sets this today). Always-crit moves
   * and Merciless crit on their own without it; Battle Armor / Shell Armor
   * cancel every kind — see the crit rule in `computeDamage`.
   */
  isCritical?: boolean;
}

export interface KoVerdict {
  /**
   * e.g. "OHKO", "2HKO", "3HKO", "4+ HKO", or a range like "OHKO–2HKO". A move
   * that makes its user faint ({@link MoveFacts.userFaints}) has ONE use, so its
   * label is "OHKO" (every roll, or — not guaranteed — some rolls: the chance
   * says how many) or "No KO"; never a 2HKO the user can't live to make.
   */
  label: string;
  /** The label holds for every roll (no "–" range; a user-fainting "OHKO" can still be partial). */
  guaranteed: boolean;
  /**
   * Chance (%) ONE use KOs — exact over INDEPENDENT rolls: every hit of a
   * multi-hit move draws its own 16-roll (Twin Beam into 155-HP Heracross is
   * 78/256 = 30.47%, not the 50% that pairing roll i with roll i gave), with
   * Focus Sash / Sturdy / Disguise / Ice Face applied hit by hit.
   */
  ohkoChance: number;
  /** Chance (%) the defender is KO'd within 1, 2 and 3 uses — `[ohko, 2hko, 3hko]` (see {@link DamageResult.uses}); all three equal for a user-fainting move. */
  koChances: number[];
}

/**
 * The move as the engine RESOLVED it for this matchup — what the UI must show
 * instead of the raw move data: Weather Ball in Sun is Fire / 100, an airborne
 * user's Expanding Force is NOT spread, Gale Wings' Brave Bird is +1.
 */
export interface MoveFacts {
  type: PokemonType;
  category: "physical" | "special";
  /** Hit 1's base power after the move's own rule (`basePowerOf`: Weather Ball ×2, Grass Knot by weight, Acrobatics…), before the bp modifier chain. Null for fixed damage (Seismic Toss…). */
  basePower: number | null;
  /** The doubles ×0.75 really applied (a spread move hitting 2+ targets). */
  spread: boolean;
  /** How many Pokémon the move hits this turn ({@link targetsHit}). */
  targets: number;
  /** Effective priority — what the blockers and turn order see (Gale Wings, Grassy Glide). */
  priority: number;
  /** Hits per use (Parental Bond 2, Population Bomb 10, Dragon Darts 1 into one of two foes). */
  hits: number;
  /**
   * The user faints using it — Explosion, Self-Destruct, Misty Explosion, Final
   * Gambit (Memento / Healing Wish are status moves) — so the verdict counts
   * this ONE use: it showed Final Gambit's 93% as a "2HKO" and Explosion into
   * Kingambit as "3HKO–4+ HKO".
   */
  userFaints: boolean;
}

/** What kept the defender standing on the FIRST use (only at full HP; see {@link computeDamage}). */
export interface Survival {
  kind: "focus-sash" | "sturdy" | "disguise" | "ice-face";
  /** e.g. "Focus Sash — survives at 1 HP", "Disguise blocks hit 1 (−16 HP)". */
  label: string;
}

export interface DamageResult {
  /** 16 damage rolls (already summed over multi-hit / Parental Bond), ascending. */
  damage: number[];
  minDamage: number;
  maxDamage: number;
  /** Defender's CURRENT HP (max × curHpPct), the KO target. */
  hp: number;
  maxHp: number;
  minPct: number;
  maxPct: number;
  typeEffectiveness: number;
  /** Type/ability/item immunity — "No effect". */
  immune: boolean;
  /**
   * Why the move FAILS outright (no immunity involved): Steel Roller with no
   * terrain, Poltergeist into an itemless target, a priority move into Psychic
   * Terrain or into Armor Tail / Queenly Majesty. Null when it connects. Damage
   * is all zeros when set.
   */
  fails: string | null;
  /** Number of hits folded into each roll (1 for normal moves, 2 for Parental Bond). */
  hits: number;
  verdict: KoVerdict;
  /** The resolved move (type, base power, spread, targets, priority, hits). */
  move: MoveFacts;
  /** A full-HP survival effect that changed the first use, or null. */
  survival: Survival | null;
  /**
   * Defender HP left after ONE use, after survival effects: `min` = every hit
   * at its top roll, `max` = every hit at its lowest. The HP bar reads THIS,
   * never `hp − damage` (Focus Sash leaves 1, Disguise leaves max − ⅛).
   */
  hpAfter: { min: number; max: number };
  /**
   * Raw damage range of uses 1, 2 and 3 (sum of each hit's min / max roll) —
   * use 1 is `minDamage`–`maxDamage`; later uses carry the per-use changes:
   * the user's own stat drops (Draco Meteor −2 SpA…), spent one-time items
   * (resist berry, Gem, a knocked-off item, a popped Air Balloon), Multiscale /
   * Shadow Shield gone, Meteor Beam's next charge. All-zero for a blank result;
   * uses 2 and 3 are all-zero for a user-fainting move (there is no next use).
   */
  uses: { min: number; max: number }[];
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

const boostOf = (mon: CalcPokemon, stat: BoostStat): number => mon.boosts?.[stat] ?? 0;

function withBoost(mon: CalcPokemon, stat: BoostStat, value: number): CalcPokemon {
  return { ...mon, boosts: { ...mon.boosts, [stat]: clampStage(value) } };
}

// --- name-keyed move tables ------------------------------------------------------
// Each is something the baked move data can't carry; `damage.test.ts` pins every
// one against @smogon/calc over the WHOLE move index, so a move the current
// ladder month doesn't sample still can't drift.

/** Special moves that strike the target's physical Defense instead of Sp. Def. */
const PSYSHOCK_MOVES = new Set(["psyshock", "psystrike", "secretsword"]);

/**
 * Moves that ALWAYS land a critical hit — @smogon/calc's gen-9 `willCrit` set.
 * Frost Breath (Mega Froslass runs it on ~38% of its Reg M-C sets), Flower
 * Trick (Meowscarada) and Storm Throw (Grapploct, Pangoro, Mega Emboar) are the
 * three in this format's move index; Wicked Blow / Surging Strikes are listed
 * so an Urshifu arrival needs no code. Keyed by NAME, like PSYSHOCK_MOVES,
 * because the baked data can't carry it: PokeAPI's `critRate` marks Frost
 * Breath and Storm Throw (6) but serves Flower Trick as 0.
 */
const ALWAYS_CRIT_MOVES = new Set([
  "flowertrick", "frostbreath", "stormthrow", "surgingstrikes", "wickedblow",
]);

/** True for a move that always lands a critical hit (Frost Breath, Flower Trick, …). */
export function alwaysCrits(moveName: string): boolean {
  return ALWAYS_CRIT_MOVES.has(stripId(moveName));
}

/**
 * Moves that ignore the target's Defense / Sp. Def STAGES — the library's
 * `ignoreDefensive` (Incineroar's Darkest Lariat, Gallade's Sacred Sword). An
 * Iron Defense / Cosmic Power / Seed boost buys nothing against them. (They
 * also ignore evasion in game — accuracy isn't part of a damage roll.)
 */
const IGNORES_DEFENSE_STAGES = new Set(["chipaway", "darkestlariat", "sacredsword"]);

/** True for a move that ignores the target's defensive stat stages (Darkest Lariat, Sacred Sword). */
export function ignoresDefenseStages(moveName: string): boolean {
  return IGNORES_DEFENSE_STAGES.has(stripId(moveName));
}

/**
 * Recoil + crash moves — what Reckless boosts (the library's `recoil ||
 * hasCrashDamage`). By name: PokeAPI serves Wave Crash with no recoil at all,
 * and crash damage (High Jump Kick, Axe Kick, Supercell Slam) has no field.
 * Mind Blown / Steel Beam / Chloroblast's HP cost is NOT recoil for Reckless.
 */
const RECKLESS_MOVES = new Set([
  "axekick", "bravebird", "doubleedge", "flareblitz", "headcharge", "headsmash",
  "highjumpkick", "jumpkick", "lightofruin", "submission", "supercellslam",
  "takedown", "volttackle", "wavecrash", "wildcharge", "woodhammer",
]);

/** True for a recoil/crash move — the moves Reckless powers up. */
export function isRecklessMove(moveName: string): boolean {
  return RECKLESS_MOVES.has(stripId(moveName));
}

/**
 * Sheer Force boosts a move iff it has a SECONDARY effect (Showdown's
 * `secondary`/`secondaries`). PokeAPI's meta (ailment / stat / flinch chance) is
 * a good proxy for most moves, but it reads two kinds of non-secondaries as
 * secondaries — the USER's own stat drops (Close Combat, Draco Meteor…) and
 * binding (Wrap, Fire Spin…) — and has no field at all for ~25 real ones
 * (Alluring Voice's confusion, Ceaseless Edge's Spikes, Salt Cure, Upper Hand's
 * flinch…). Both lists are exactly the whole-index disagreement with the
 * library. Champions REMOVED Freeze-Dry's freeze chance (the mod's moves.ts:
 * `secondary: undefined`), so Sheer Force correctly no longer boosts it here —
 * the one place this deliberately differs from the library's mainline data.
 */
const NOT_SECONDARY = new Set([
  "bind", "clangingscales", "closecombat", "dracometeor", "firespin", "hammerarm",
  "icehammer", "infestation", "leafstorm", "overheat", "sandtomb", "smackdown",
  "snaptrap", "superpower", "whirlpool", "wrap",
]);
const EXTRA_SECONDARY = new Set([
  "alluringvoice", "aquastep", "axekick", "barbbarrage", "bittermalice", "ceaselessedge",
  "chillingwater", "direclaw", "eeriespell", "infernalparade", "luminacrash", "matchagotcha",
  "mortalspin", "mountaingale", "pounce", "psychicnoise", "psyshieldbash", "saltcure",
  "sparklingaria", "spiritshackle", "stoneaxe", "torchsong", "trailblaze", "triplearrows",
  "upperhand",
]);

/** Whether a move has a secondary effect — what Sheer Force powers up (and removes). */
export function hasSecondaryEffect(m: Pick<MoveSummary,
  "displayName" | "ailment" | "ailmentChance" | "statChance" | "statChanges" | "flinchChance">): boolean {
  const id = stripId(m.displayName);
  if (EXTRA_SECONDARY.has(id)) return true;
  if (NOT_SECONDARY.has(id)) return false;
  return (m.ailment != null && m.ailmentChance > 0) ||
    (m.statChance > 0 && (m.statChanges?.length ?? 0) > 0) ||
    m.flinchChance > 0;
}

/**
 * The user's own guaranteed Atk / SpA drop, by stages — the library's
 * `dropsStats`. It matters between hits: a Parental Bond child hit lands after
 * the drop. Make It Rain is Champions' −2 (the mod's moves.ts; mainline −1).
 */
const SELF_ATTACK_DROPS: Record<string, number> = {
  dracometeor: 2, fleurcannon: 2, leafstorm: 2, makeitrain: 2, overheat: 2,
  psychoboost: 2, superpower: 1,
};

/** The user's guaranteed Atk/SpA drop in stages (0 for none) — what a Parental Bond child hit lands after. */
export function selfAttackDrop(moveName: string): number {
  return SELF_ATTACK_DROPS[stripId(moveName)] ?? 0;
}

/** Hit counts PokeAPI doesn't carry (it serves both as single-hit). */
const FIXED_HITS: Record<string, number> = { populationbomb: 10, twinbeam: 2 };

/** Variable-power moves whose base power the engine computes at calc time. */
export const VARIABLE_MOVES = new Set([
  "grassknot", "lowkick", "heavyslam", "heatcrash", "gyroball", "electroball",
  // HP-scaled (the calc's HP control): user's (Flail/Reversal), target's (Hard Press).
  "flail", "reversal", "hardpress", "crushgrip", "wringout",
  // Fixed damage: the user's level (always 50 here) / the user's current HP.
  "seismictoss", "nightshade", "finalgambit",
]);

/**
 * Knock Off only gets its 1.5× when there is an item it can actually remove.
 * In this format the sole unremovable item is a **Mega Stone** held by its own
 * Mega — and every Mega Stone name ends in "-ite", optionally with a form
 * suffix: Charizardite Y, Raichunite X, and since Champions v1.2.0 the **Z**
 * stones Lucarionite Z / Garchompite Z / Absolite Z that trigger Z Mega
 * Evolution. `Eviolite` is the one item in the pool that ends the same way and
 * is NOT a stone, so it is excluded by name.
 *
 * The Z suffix is the whole reason this is a regex and not `endsWith("ite")`:
 * before v1.2.0 the pattern stopped at X/Y, so a Z stone read as removable and
 * Knock Off wrongly took its 1.5× against the three Z Megas holding their own
 * stone. Any future suffix needs adding HERE and to the pool test.
 *
 * Champions invents its own stones (Chimechite, Scovillainite, Meganiumite…)
 * that @smogon/calc's item table has never heard of, so the library can't be the
 * oracle here — `damage.test.ts` instead pins the rule against the baked item
 * pool: an item ends in "-ite" iff only Mega forms are ever seen holding it.
 */
const NOT_A_MEGA_STONE = new Set(["eviolite"]);

export function isMegaStone(item: string | null | undefined): boolean {
  if (!item) return false;
  const id = stripId(item);
  if (NOT_A_MEGA_STONE.has(id)) return false;
  return /ite[xyz]?$/.test(id);
}

// --- ability / item tables -------------------------------------------------------

/**
 * Defender abilities a Mold Breaker / Teravolt / Turboblaze attacker ignores —
 * @smogon/calc's list verbatim, plus the two Champions-original abilities
 * Showdown flags `breakable: 1` (Aura Guard, Eelevate). Multiscale, Levitate,
 * the Armors (so it crits through Battle/Shell Armor), Thick Fat, Fur Coat,
 * Fluffy, Filter/Solid Rock, the immunity abilities, Armor Tail… all go quiet.
 * Prism Armor / Shadow Shield are NOT on it (they can't be broken).
 */
const MOLD_BREAKER_IGNORES = new Set([
  "Armor Tail", "Aroma Veil", "Aura Break", "Battle Armor", "Big Pecks", "Bulletproof",
  "Clear Body", "Contrary", "Damp", "Dazzling", "Disguise", "Dry Skin", "Earth Eater",
  "Filter", "Flash Fire", "Flower Gift", "Flower Veil", "Fluffy", "Friend Guard",
  "Fur Coat", "Good as Gold", "Grass Pelt", "Guard Dog", "Heatproof", "Heavy Metal",
  "Hyper Cutter", "Ice Face", "Ice Scales", "Illuminate", "Immunity", "Inner Focus",
  "Insomnia", "Keen Eye", "Leaf Guard", "Levitate", "Light Metal", "Lightning Rod",
  "Limber", "Magic Bounce", "Magma Armor", "Marvel Scale", "Mind's Eye", "Mirror Armor",
  "Motor Drive", "Multiscale", "Oblivious", "Overcoat", "Own Tempo", "Pastel Veil",
  "Punk Rock", "Purifying Salt", "Queenly Majesty", "Sand Veil", "Sap Sipper",
  "Shell Armor", "Shield Dust", "Simple", "Snow Cloak", "Solid Rock", "Soundproof",
  "Sticky Hold", "Storm Drain", "Sturdy", "Suction Cups", "Sweet Veil", "Tangled Feet",
  "Telepathy", "Tera Shell", "Thermal Exchange", "Thick Fat", "Unaware", "Vital Spirit",
  "Volt Absorb", "Water Absorb", "Water Bubble", "Water Veil", "Well-Baked Body",
  "White Smoke", "Wind Rider", "Wonder Guard", "Wonder Skin",
  // Champions-original, `flags: { breakable: 1 }` in Showdown's abilities.ts.
  "Aura Guard", "Eelevate",
].map(stripId));

/**
 * The "-ate" family: a Normal move becomes this type AND gets 1.2× (4915).
 * Mega Salamence's Aerilate, Sylveon / Mega Gardevoir / Mega Altaria's Pixilate,
 * Mega Glalie / Aurorus' Refrigerate — and Champions' own **Dragonize** (Mega
 * Feraligatr), which Showdown's abilities.ts writes line-for-line like Pixilate
 * with `move.type = 'Dragon'` (same `noModifyType` list, same 4915).
 * Normalize is the inverse (every move → Normal, same 1.2×).
 */
const ATE_TYPE: Record<string, PokemonType> = {
  aerilate: "flying", dragonize: "dragon", galvanize: "electric", pixilate: "fairy", refrigerate: "ice",
};

/** Moves an -ate ability / Liquid Voice never retype (they set their own type). */
const NO_TYPE_CHANGE = new Set([
  "judgment", "multiattack", "naturalgift", "naturepower", "revelationdance",
  "struggle", "technoblast", "terrainpulse", "weatherball",
]);

/** Move types a defender ability makes it flat-out immune to (→ effectiveness 0). */
const IMMUNITY: Record<string, PokemonType> = {
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

/** Abilities that block every priority move aimed at the holder (and its ally). */
const PRIORITY_BLOCKERS = ["Armor Tail", "Dazzling", "Queenly Majesty"];

/** The Champions pool's type-boosting held items: 1.2× (4915) on their type. */
const TYPE_BOOST_ITEMS: Record<string, PokemonType> = {
  blackbelt: "fighting", blackglasses: "dark", charcoal: "fire", dragonfang: "dragon",
  fairyfeather: "fairy", hardstone: "rock", magnet: "electric", metalcoat: "steel",
  miracleseed: "grass", mysticwater: "water", nevermeltice: "ice", poisonbarb: "poison",
  sharpbeak: "flying", silkscarf: "normal", silverpowder: "bug", softsand: "ground",
  spelltag: "ghost", twistedspoon: "psychic",
};

/** The Champions pool's resist berries: halve one super-effective hit of their type (Chilan: any Normal hit). */
const RESIST_BERRIES: Record<string, PokemonType> = {
  babiriberry: "steel", chartiberry: "rock", chilanberry: "normal", chopleberry: "fighting",
  cobaberry: "flying", colburberry: "dark", habanberry: "dragon", kasibberry: "ghost",
  kebiaberry: "poison", occaberry: "fire", passhoberry: "water", payapaberry: "psychic",
  rindoberry: "grass", roseliberry: "fairy", shucaberry: "ground", tangaberry: "bug",
  wacanberry: "electric", yacheberry: "ice",
};

/** Raging Bull takes the Paldean Tauros breed's type. */
const RAGING_BULL_TYPE: Record<string, PokemonType> = {
  "Tauros-Paldea-Combat": "fighting", "Tauros-Paldea-Blaze": "fire", "Tauros-Paldea-Aqua": "water",
};

// --- field / state helpers -------------------------------------------------------

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
  const r = attackerKg / defenderKg;
  if (r >= 5) return 120;
  if (r >= 4) return 100;
  if (r >= 3) return 80;
  if (r >= 2) return 60;
  return 40;
}

/**
 * Weight as the weight moves see it — the library's `getWeight`, same integer
 * hectogram arithmetic (so a 5.0× Heavy Slam ratio can't round to 4.99…):
 * Heavy Metal doubles it (Aggron), Light Metal halves it (Scizor, Metagross).
 */
function effectiveWeight(mon: CalcPokemon): number {
  let hg = (mon.weightKg ?? 0) * 10;
  const factor = has(mon.ability, "Heavy Metal") ? 2 : has(mon.ability, "Light Metal") ? 0.5 : 1;
  if (factor !== 1) hg = Math.max(Math.trunc(hg * factor), 1);
  return hg / 10;
}

/**
 * On the ground for terrain purposes — @smogon/calc's `isGrounded` (Gravity
 * isn't in this format). Flying types, Levitate and Air Balloon float — and so
 * does Champions' **Eelevate** (Mega Eelektross: Showdown's `isGrounded` reads
 * `hasAbility(['levitate', 'eelevate'])`). An Iron Ball (Hippowdon, Musharna run
 * it for Trick Room) pins anything down.
 */
function isGrounded(mon: CalcPokemon): boolean {
  if (has(mon.item, "Iron Ball")) return true;
  return !mon.types.includes("flying") && !has(mon.ability, "Levitate", "Eelevate") &&
    !has(mon.item, "Air Balloon");
}

/**
 * Speed as the turn-order and speed-scaled moves see it — the library's
 * `getFinalSpeed`: stages, then ONE chain of Tailwind (×2, first), the
 * weather/terrain speed abilities (×2) / Quick Feet, Choice Scarf (×1.5) / Iron
 * Ball (×0.5), then paralysis (×0.5, floored after the chain). It feeds Gyro
 * Ball / Electro Ball's power, the "who moves last" reads of Payback and
 * Analytic, and {@link effectiveSpeeds} (the calc's turn-order line).
 * (Unburden is battle state the calc doesn't take.)
 */
function finalSpeed(mon: CalcPokemon, spe: number, weather: Weather, terrain: Terrain, tailwind = false): number {
  let speed = modifiedStat(spe, boostOf(mon, "spe"));
  const mods: number[] = [];
  if (tailwind) mods.push(8192);
  if ((has(mon.ability, "Chlorophyll") && weather === "Sun") ||
      (has(mon.ability, "Sand Rush") && weather === "Sand") ||
      (has(mon.ability, "Swift Swim") && weather === "Rain") ||
      (has(mon.ability, "Slush Rush") && weather === "Snow") ||
      (has(mon.ability, "Surge Surfer") && terrain === "Electric")) {
    mods.push(8192);
  } else if (has(mon.ability, "Quick Feet") && mon.status) {
    mods.push(6144);
  }
  if (has(mon.item, "Choice Scarf")) mods.push(6144);
  else if (has(mon.item, "Iron Ball")) mods.push(2048);
  // 131172 (sic) — the library's own upper clamp for this one chain.
  speed = pokeRound((speed * chainMods(mods, 410, 131172)) / 4096);
  if (mon.status === "par" && !has(mon.ability, "Quick Feet")) speed = Math.floor((speed * 50) / 100);
  return Math.max(0, Math.min(10000, speed));
}

/** The move type each terrain powers up for a grounded user (Misty powers none). */
const TERRAIN_BOOSTED_TYPE: Partial<Record<NonNullable<Terrain>, PokemonType>> = {
  Electric: "electric",
  Grassy: "grass",
  Psychic: "psychic",
};

/** Terrain Pulse's type under each terrain. */
const TERRAIN_PULSE_TYPE: Record<NonNullable<Terrain>, PokemonType> = {
  Electric: "electric",
  Grassy: "grass",
  Misty: "fairy",
  Psychic: "psychic",
};

/** Weather Ball's type under each weather. */
const WEATHER_BALL_TYPE: Record<NonNullable<Weather>, PokemonType> = {
  Sun: "fire",
  Rain: "water",
  Sand: "rock",
  Snow: "ice",
};

/**
 * A Seed fires — and is used up — the moment its terrain is up: +1 Def
 * (Electric/Grassy Seed) or +1 SpD (Psychic/Misty Seed), inverted by Contrary.
 * Mirrors @smogon/calc's `checkSeedBoost`, item consumption included (so a
 * spent Seed no longer powers up Knock Off or saves a Poltergeist target).
 */
function withSeedBoost(mon: CalcPokemon, terrain: Terrain | undefined): CalcPokemon {
  if (!terrain || !has(mon.item, `${terrain} Seed`)) return mon;
  const stat: BoostStat = terrain === "Electric" || terrain === "Grassy" ? "def" : "spd";
  const cur = boostOf(mon, stat);
  const next = has(mon.ability, "Contrary") ? Math.max(-6, cur - 1) : Math.min(6, cur + 1);
  return { ...mon, item: null, boosts: { ...mon.boosts, [stat]: next } };
}

/** Castform's Forecast: its type follows the weather (Sand leaves it Normal). */
function withForecast(mon: CalcPokemon, weather: Weather): CalcPokemon {
  if (!has(mon.ability, "Forecast") || mon.name !== "Castform") return mon;
  const t: PokemonType = weather === "Sun" ? "fire" : weather === "Rain" ? "water" : weather === "Snow" ? "ice" : "normal";
  return { ...mon, types: [t] };
}

/**
 * How many hits a move lands: Skill Link maxes a 2–5 hitter at 5, otherwise
 * the library's expectation of 3; Population Bomb (10) and Twin Beam (2) are
 * fixed counts PokeAPI serves as single hits. **Dragon Darts** fires one dart
 * at EACH foe when two are out (`targets` ≥ 2 → 1 hit into the selected one)
 * and both darts into a lone foe (→ 2) — @smogon/calc always rolls 2.
 */
function hitCount(move: CalcMove, attacker: CalcPokemon, targets = 1): number {
  if (stripId(move.name) === "dragondarts") return targets >= 2 ? 1 : 2;
  const fixed = FIXED_HITS[stripId(move.name)];
  if (fixed) return fixed;
  const min = move.minHits ?? 1;
  const max = move.maxHits ?? 1;
  if (max <= 1) return 1;
  if (min === max) return min;
  return has(attacker.ability, "Skill Link") ? max : min + 1;
}

/** A move that is multi-hit by itself (so Parental Bond leaves it alone) — Dragon Darts included even at 1 dart. */
function isMultiHitMove(move: CalcMove): boolean {
  const id = stripId(move.name);
  return id === "dragondarts" || !!FIXED_HITS[id] || (move.maxHits ?? 1) > 1;
}

const sideCount = (n: number | undefined): number => (n === 1 ? 1 : 2);

/**
 * How many Pokémon `move` actually hits this turn — the input the doubles ×0.75
 * and Dragon Darts' dart count are keyed on. Singles / `singleTarget` → 1;
 * Dragon Darts → the number of foes (one dart each); `all-opponents` → the
 * defender's side; `all-other-pokemon` (Earthquake) → the defender's side plus
 * the attacker's own ally; anything else → 1. Pass the RESOLVED target
 * (Expanding Force is `all-opponents` only for a grounded user in Psychic Terrain).
 */
export function targetsHit(move: Pick<CalcMove, "name" | "target">, field: CalcField): number {
  if ((field.gameType ?? "Doubles") === "Singles" || field.singleTarget) return 1;
  const foes = sideCount(field.defenderSide);
  const allies = sideCount(field.attackerSide);
  if (stripId(move.name) === "dragondarts") return foes;
  if (move.target === "all-opponents") return foes;
  if (move.target === "all-other-pokemon") return foes + allies - 1;
  return 1;
}

/** True for a move that hits two-plus targets this turn (→ the doubles ×0.75). */
function isSpreadHit(move: CalcMove, field: CalcField): boolean {
  return isSpreadMove(move.target) && targetsHit(move, field) >= 2;
}

// --- the per-calc state -----------------------------------------------------------

/** Everything decided once, before the first hit (the library's "Initial" region). */
interface Ctx {
  attacker: CalcPokemon;
  defender: CalcPokemon;
  move: CalcMove;
  id: string;
  physical: boolean;
  /** Field weather after Cloud Nine / Air Lock. */
  weather: Weather;
  /** The weather the ATTACKER's move sees: Mega Sol → always Sun. */
  moveWeather: Weather;
  terrain: Terrain;
  isDoubles: boolean;
  spread: boolean;
  helpingHand: boolean;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  friendGuard: boolean;
  crit: boolean;
  eff: number;
  ateBoost: boolean;
  expandingForce: boolean;
  /** The item Knock Off would remove (Klutz still holds one; a spent Seed is gone). */
  knockItem: string | null;
  aRaw: Record<BoostStat | "hp", number>;
  dRaw: Record<BoostStat | "hp", number>;
  aHp: number;
  dHp: number;
  /** The defender is at full HP for this hit (Multiscale / Shadow Shield) — false from the 2nd use on. */
  dFull: boolean;
  /** Tailwind on each side (the speed chain). */
  aTailwind: boolean;
  dTailwind: boolean;
  /**
   * STAB and burn are fixed for the whole calc — the library's multi-hit loop
   * never recomputes them — save a Parental Bond child (re-read) and a Spicy
   * Spray burn landing between hits (`betweenHits`).
   */
  stabMod: number;
  isBurned: boolean;
}

// --- base power ------------------------------------------------------------------

/** The move's own base power, as the library's `calculateBasePowerSMSSSV` switch resolves it. */
function basePowerOf(c: Ctx, hit: number, pbChild: boolean, movesLast: boolean): number {
  const { attacker: a, defender: d, move } = c;
  const aSpe = finalSpeed(a, c.aRaw.spe, c.weather, c.terrain, c.aTailwind);
  const dSpe = finalSpeed(d, c.dRaw.spe, c.weather, c.terrain, c.dTailwind);
  switch (c.id) {
    case "payback":
      return move.basePower * (movesLast ? 2 : 1);
    case "boltbeak":
    case "fishiousrend":
      return move.basePower * (!movesLast ? 2 : 1);
    case "electroball": {
      if (dSpe === 0) return 40;
      const r = Math.floor(aSpe / dSpe);
      return r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40;
    }
    case "gyroball":
      if (aSpe === 0) return 1;
      return Math.min(150, Math.floor((25 * dSpe) / aSpe) + 1);
    case "lowkick":
    case "grassknot":
      return weightBP(effectiveWeight(d));
    case "hex":
    case "infernalparade":
      return move.basePower * (d.status ? 2 : 1);
    case "barbbarrage":
      return move.basePower * (d.status === "psn" || d.status === "tox" ? 2 : 1);
    case "heavyslam":
    case "heatcrash":
      return weightRatioBP(effectiveWeight(a), effectiveWeight(d));
    case "storedpower":
    case "powertrip": {
      let n = 0;
      for (const s of ["atk", "def", "spa", "spd", "spe"] as BoostStat[]) n += Math.max(0, boostOf(a, s));
      return 20 + 20 * n;
    }
    case "acrobatics":
      // Doubles the base power itself (not a chain modifier) — so an itemless
      // Acrobatics is 110 and Technician (≤ 60) no longer touches it.
      return move.basePower * (!a.item ? 2 : 1);
    case "assurance":
      return move.basePower * (pbChild ? 2 : 1);
    case "weatherball":
      return move.basePower * (c.moveWeather ? 2 : 1);
    case "terrainpulse":
      return move.basePower * (isGrounded(a) && c.terrain ? 2 : 1);
    case "risingvoltage":
      return move.basePower * (isGrounded(d) && c.terrain === "Electric" ? 2 : 1);
    case "eruption":
    case "waterspout":
    case "dragonenergy":
      return Math.max(1, Math.floor((150 * c.aHp) / c.aRaw.hp));
    case "flail":
    case "reversal": {
      const p = Math.floor((48 * c.aHp) / c.aRaw.hp);
      return p <= 1 ? 200 : p <= 4 ? 150 : p <= 9 ? 100 : p <= 16 ? 80 : p <= 32 ? 40 : 20;
    }
    case "crushgrip":
    case "wringout":
    case "hardpress": {
      const top = c.id === "hardpress" ? 100 : 120;
      const frac = 100 * Math.floor((c.dHp * 4096) / c.dRaw.hp);
      return Math.floor(Math.floor((top * frac + 2048 - 1) / 4096) / 100) || 1;
    }
    case "tripleaxel":
      return hit * 20;
    case "triplekick":
      return hit * 10;
    default:
      return move.basePower;
  }
}

/** The bp modifier chain, in @smogon/calc's order (the chain rounds every step, so order is spec). */
function bpModsOf(c: Ctx, basePower: number, hit: number, movesLast: boolean): number[] {
  const { attacker: a, defender: d, move, id } = c;
  const mods: number[] = [];
  const type = move.type;

  // Move effects — ONE else-if rung, as the library chains them.
  const knockOff = id === "knockoff" && !!c.knockItem && !isMegaStone(c.knockItem) && hit === 1;
  if ((id === "facade" && (a.status === "brn" || a.status === "par" || a.status === "psn" || a.status === "tox")) ||
      (id === "brine" && c.dHp <= c.dRaw.hp / 2) ||
      (id === "venoshock" && (d.status === "psn" || d.status === "tox"))) {
    mods.push(8192);
  } else if (c.expandingForce) {
    mods.push(6144);
  } else if (knockOff || (id === "mistyexplosion" && c.terrain === "Misty" && isGrounded(a))) {
    // Knock Off is 1.5× only when the target actually has an item to lose — no
    // item (or an un-knockable Mega Stone) leaves it at its plain 65 BP.
    mods.push(6144);
  } else if ((id === "solarbeam" || id === "solarblade") &&
      (c.moveWeather === "Rain" || c.moveWeather === "Sand" || c.moveWeather === "Snow")) {
    mods.push(2048);
  }

  if (c.helpingHand) mods.push(6144);

  // Terrain sits right after Helping Hand, as @smogon/calc chains it.
  if (c.terrain && isGrounded(a) && TERRAIN_BOOSTED_TYPE[c.terrain] === type) mods.push(5325);
  if (isGrounded(d) && ((c.terrain === "Misty" && type === "dragon") ||
      (c.terrain === "Grassy" && (id === "earthquake" || id === "bulldoze")))) {
    mods.push(2048);
  }

  // The 1.5× ability rung (one push: a mon has one ability).
  if ((has(a.ability, "Technician") && basePower <= 60) ||
      (has(a.ability, "Flare Boost") && a.status === "brn" && !c.physical) ||
      (has(a.ability, "Toxic Boost") && (a.status === "psn" || a.status === "tox") && c.physical) ||
      (has(a.ability, "Mega Launcher") && move.flags?.includes("pulse")) ||
      (has(a.ability, "Strong Jaw") && move.flags?.includes("bite")) ||
      (has(a.ability, "Steely Spirit") && type === "steel") ||
      (has(a.ability, "Sharpness") && move.flags?.includes("slicing"))) {
    mods.push(6144);
  }

  // Fairy Aura (Mega Floette) / Dark Aura power up EVERY matching move on the
  // field — the holder's own and its target's alike; Aura Break flips it to ×0.75.
  if ((type === "fairy" && (has(a.ability, "Fairy Aura") || has(d.ability, "Fairy Aura"))) ||
      (type === "dark" && (has(a.ability, "Dark Aura") || has(d.ability, "Dark Aura")))) {
    mods.push(has(a.ability, "Aura Break") || has(d.ability, "Aura Break") ? 3072 : 5448);
  }

  // The 1.3× ability rung.
  if ((has(a.ability, "Sheer Force") && (move.hasSecondary || id === "electroshot" || id === "orderup")) ||
      (has(a.ability, "Sand Force") && c.weather === "Sand" && (type === "rock" || type === "ground" || type === "steel")) ||
      (has(a.ability, "Analytic") && movesLast) ||
      (has(a.ability, "Tough Claws") && move.flags?.includes("contact")) ||
      (has(a.ability, "Punk Rock") && move.flags?.includes("sound"))) {
    mods.push(5325);
  }

  // -ate / Dragonize / Normalize: the type already changed; this is the 1.2×.
  if (c.ateBoost) mods.push(4915);

  if ((has(a.ability, "Reckless") && RECKLESS_MOVES.has(id)) ||
      (has(a.ability, "Iron Fist") && move.flags?.includes("punch"))) {
    mods.push(4915);
  }

  // Dry Skin's Fire weakness is a BP modifier (Heatproof moved to the attack chain in gen 9).
  if (has(d.ability, "Dry Skin") && type === "fire") mods.push(5120);

  // Items — LAST, where @smogon/calc chains them: the chain rounds at every
  // step, so order is part of the spec (Gem → HH → Technician lands one unit
  // off). A Gem is 5325, NOT the 5324 Life Orb uses; the parity test catches
  // the one-roll drift if you reach for the wrong constant.
  const item = a.item ? stripId(a.item) : "";
  if (item && item === `${type}gem`) mods.push(5325);
  else if (item && TYPE_BOOST_ITEMS[item] === type) mods.push(4915);
  else if ((item === "muscleband" && c.physical) || (item === "wiseglasses" && !c.physical)) mods.push(4505);
  return mods;
}

// --- attack / defense ------------------------------------------------------------

function attackOf(c: Ctx): number {
  const { attacker: a, defender: d, move, physical } = c;
  // Foul Play uses the DEFENDER's Attack stat (+ its boosts); the attacker's
  // own abilities/items (Choice Band, Guts, …) still apply via the mod chain.
  // Body Press is a Physical move that attacks with the USER's Defense stat
  // (its own Def boosts included — that's the Iron Defense combo).
  const stat: BoostStat = c.id === "bodypress" ? "def" : physical ? "atk" : "spa";
  const foulPlay = c.id === "foulplay";
  let attack = (foulPlay ? c.dRaw : c.aRaw)[stat];
  const boost = boostOf(foulPlay ? d : a, stat);
  // A crit ignores the attacker's NEGATIVE stages (an Intimidated Storm Throw
  // still hits at full Attack) but keeps positive ones; Unaware ignores both.
  if (boost !== 0 && !(c.crit && boost < 0) && !has(d.ability, "Unaware")) {
    attack = modifiedStat(attack, boost);
  }
  // Hustle multiplies the stat directly, outside the modifier chain.
  if (has(a.ability, "Hustle") && physical) attack = pokeRound((attack * 3) / 2);

  const mods: number[] = [];
  const type = move.type;
  const lowHp = c.aHp <= c.aRaw.hp / 3;
  // The attacker's ability — one else-if ladder, as the library writes it.
  if (has(a.ability, "Defeatist") && c.aHp <= c.aRaw.hp / 2) {
    mods.push(2048);
  } else if (has(a.ability, "Solar Power") && c.weather === "Sun" && !physical) {
    mods.push(6144);
  } else if (has(a.ability, "Gorilla Tactics") && physical) {
    mods.push(6144);
  } else if ((has(a.ability, "Guts") && a.status && physical) ||
      (lowHp && ((has(a.ability, "Overgrow") && type === "grass") || (has(a.ability, "Blaze") && type === "fire") ||
        (has(a.ability, "Torrent") && type === "water") || (has(a.ability, "Swarm") && type === "bug")))) {
    mods.push(6144);
  } else if ((has(a.ability, "Steelworker") && type === "steel") ||
      (has(a.ability, "Dragon's Maw") && type === "dragon") ||
      (has(a.ability, "Rocky Payload") && type === "rock") ||
      // Champions' Fire Mane (Mega Pyroar): Showdown's abilities.ts gives it
      // Steelworker's exact shape for Fire — onModifyAtk/SpA priority 5, ×1.5.
      (has(a.ability, "Fire Mane") && type === "fire")) {
    mods.push(6144);
  } else if (has(a.ability, "Transistor") && type === "electric") {
    mods.push(5325);
  } else if ((has(a.ability, "Water Bubble") && type === "water") ||
      (has(a.ability, "Huge Power", "Pure Power") && physical)) {
    mods.push(8192);
  }
  if ((has(d.ability, "Thick Fat") && (type === "fire" || type === "ice")) ||
      (has(d.ability, "Water Bubble") && type === "fire") ||
      (has(d.ability, "Purifying Salt") && type === "ghost")) {
    mods.push(2048);
  }
  if (has(d.ability, "Heatproof") && type === "fire") mods.push(2048);
  // Choice Band / Specs hold on a crit — a crit drops stat STAGES, never items.
  // (This read `!crit && …` from the first port: harmless while nothing could
  // crit, a silent 1.5× loss the moment an always-crit move did.)
  if (has(a.item, "Light Ball") && a.name.includes("Pikachu")) {
    mods.push(8192);
  } else if ((has(a.item, "Choice Band") && physical) || (has(a.item, "Choice Specs") && !physical)) {
    mods.push(6144);
  }
  return Math.max(1, pokeRound((attack * chainMods(mods, 410, 131072)) / 4096));
}

function defenseOf(c: Ctx): number {
  const { attacker: a, defender: d } = c;
  // Psyshock / Psystrike / Secret Sword are Special moves that hit Defense.
  const hitsPhysicalDef = c.physical || PSYSHOCK_MOVES.has(c.id);
  const stat: BoostStat = hitsPhysicalDef ? "def" : "spd";
  let defense = c.dRaw[stat];
  const boost = boostOf(d, stat);
  // A crit ignores the defender's positive stages; Darkest Lariat / Sacred
  // Sword ignore every stage; Unaware ignores both.
  if (boost !== 0 && !(c.crit && boost > 0) && !IGNORES_DEFENSE_STAGES.has(c.id) && !has(a.ability, "Unaware")) {
    defense = modifiedStat(defense, boost);
  }
  // The weather the ATTACKER's move sees: while a Mega Sol holder moves,
  // Showdown's effectiveWeather() reads 'sunnyday' for every Pokémon — and the
  // Sand SpD / Snow Def boosts check exactly that — so a Rock type in Sand gets
  // no SpD boost against Mega Meganium. (Everyone else: moveWeather = weather.)
  if (c.moveWeather === "Sand" && d.types.includes("rock") && !hitsPhysicalDef) {
    defense = pokeRound((defense * 3) / 2);
  }
  if (c.moveWeather === "Snow" && d.types.includes("ice") && hitsPhysicalDef) {
    defense = pokeRound((defense * 3) / 2);
  }
  const mods: number[] = [];
  if (has(d.ability, "Marvel Scale") && d.status && hitsPhysicalDef) mods.push(6144);
  else if (has(d.ability, "Grass Pelt") && c.terrain === "Grassy" && hitsPhysicalDef) mods.push(6144);
  // Fur Coat is an ABILITY (Alolan Persian, Furfrou). It read
  // `has(defender.item, "Fur Coat")` until 2026-11-18 — an item nobody can hold —
  // so physical hits into it rolled ~2× too high.
  else if (has(d.ability, "Fur Coat") && hitsPhysicalDef) mods.push(8192);
  if (has(d.item, "Eviolite") || (!hitsPhysicalDef && has(d.item, "Assault Vest"))) mods.push(6144);
  return Math.max(1, pokeRound((defense * chainMods(mods, 410, 131072)) / 4096));
}

// --- one hit ---------------------------------------------------------------------

function finalModsOf(c: Ctx, hitIndex: number, pbChild: boolean): number[] {
  const { attacker: a, defender: d, move, physical, eff } = c;
  const mods: number[] = [];
  const screen = c.isDoubles ? 2732 : 2048;
  if (c.reflect && physical && !c.crit && !c.auroraVeil) mods.push(screen);
  else if (c.lightScreen && !physical && !c.crit && !c.auroraVeil) mods.push(screen);
  if (c.auroraVeil && !c.crit) mods.push(screen);
  if (has(a.ability, "Neuroforce") && eff > 1) mods.push(5120);
  // Sniper: a crit lands a further 1.5× (6144) — on the same else-if rung as
  // @smogon/calc, so Neuroforce outranks it and it outranks Tinted Lens.
  else if (has(a.ability, "Sniper") && c.crit) mods.push(6144);
  else if (has(a.ability, "Tinted Lens") && eff < 1) mods.push(8192);
  // Multiscale only guards the FIRST hit at full HP (never a Parental Bond child,
  // never a later use — the first one already cost HP).
  if (has(d.ability, "Multiscale", "Shadow Shield") && c.dFull && hitIndex === 0 && !pbChild) {
    mods.push(2048);
  }
  // Long Reach strips contact, so neither contact-halver sees it. Champions'
  // Aura Guard (Mega Lucario Z) is Showdown's `onSourceModifyDamage … contact
  // → chainModify(0.5)` — Fluffy's contact half exactly, so it shares the rung.
  const contact = !!move.flags?.includes("contact") && !has(a.ability, "Long Reach");
  if (contact && has(d.ability, "Fluffy", "Aura Guard")) mods.push(2048);
  else if ((has(d.ability, "Punk Rock") && move.flags?.includes("sound")) ||
      (has(d.ability, "Ice Scales") && !physical)) {
    mods.push(2048);
  }
  if (has(d.ability, "Solid Rock", "Filter", "Prism Armor") && eff > 1) mods.push(3072);
  if (c.friendGuard) mods.push(3072);
  if (has(d.ability, "Fluffy") && move.type === "fire") mods.push(8192);
  if (has(a.item, "Expert Belt") && eff > 1) mods.push(4915);
  else if (has(a.item, "Life Orb")) mods.push(5324);
  // A resist berry halves the first super-effective hit of its type (Chilan:
  // any Normal hit); Ripen doubles the berry; Unnerve stops the eat.
  const berry = d.item ? RESIST_BERRIES[stripId(d.item)] : undefined;
  if (berry === move.type && (eff > 1 || move.type === "normal") && hitIndex === 0 &&
      !has(a.ability, "Unnerve", "As One (Glastrier)", "As One (Spectrier)")) {
    mods.push(has(d.ability, "Ripen") ? 1024 : 2048);
  }
  return mods;
}

/** STAB — Protean / Libero make every move STAB; Adaptability makes it 2×. */
function stabOf(a: CalcPokemon, type: PokemonType): number {
  let stab = 4096;
  if (a.types.includes(type)) stab += 2048;
  else if (has(a.ability, "Protean", "Libero")) stab += 2048;
  if (has(a.ability, "Adaptability") && a.types.includes(type)) stab += 2048;
  return stab;
}

/** A burn halves physical damage — except through Guts, and never Facade's. */
const burnHalves = (a: CalcPokemon, physical: boolean, id: string): boolean =>
  a.status === "brn" && physical && !has(a.ability, "Guts") && id !== "facade";

/** Turn order as the damage rolls read it (Payback, Analytic, Bolt Beak): a Speed tie counts as moving last. */
function movesLastOf(c: Ctx): boolean {
  return !(finalSpeed(c.attacker, c.aRaw.spe, c.weather, c.terrain, c.aTailwind) >
    finalSpeed(c.defender, c.dRaw.spe, c.weather, c.terrain, c.dTailwind));
}

/** One hit's 16 rolls (85…100%), ascending. */
function rollHit(c: Ctx, hit: number, pbChild: boolean): number[] {
  // Turn order from final Speed, re-read every hit as the library does (Weak
  // Armor's +2 Spe can flip it mid-move); a Speed tie counts as moving last.
  const movesLast = movesLastOf(c);
  const basePower = basePowerOf(c, hit, pbChild, movesLast);
  const bp = Math.max(1, pokeRound((basePower * chainMods(bpModsOf(c, basePower, hit, movesLast), 41, 2097152)) / 4096));
  const attack = attackOf(c);
  const defense = defenseOf(c);

  let base = Math.floor(Math.floor((Math.floor((2 * 50) / 5 + 2) * bp * attack) / defense) / 50 + 2);
  // ×0.75 only when the move actually hits 2+ targets — a spread move into a
  // lone remaining foe lands at full power. Default stays "both foes out",
  // which is what @smogon/calc computes and what damage.test.ts pins.
  if (c.spread) base = pokeRound((base * SPREAD_NUMERATOR) / SPREAD_DENOMINATOR);
  // Parental Bond's second hit: ¼ of the base damage (gen 7+).
  if (pbChild) base = pokeRound((base * 1024) / 4096);
  // Weather as the ATTACKER's move sees it (Mega Sol: always Sun).
  const w = c.moveWeather;
  if ((w === "Sun" && c.move.type === "fire") || (w === "Rain" && c.move.type === "water")) {
    base = pokeRound((base * 6144) / 4096);
  } else if ((w === "Sun" && c.move.type === "water") || (w === "Rain" && c.move.type === "fire")) {
    base = pokeRound((base * 2048) / 4096);
  }
  if (c.crit) base = Math.floor(base * 1.5);

  const finalMod = chainMods(finalModsOf(c, hit - 1, pbChild), 41, 131072);

  const out: number[] = [];
  for (let i = 0; i < 16; i++) {
    let d = Math.floor((base * (85 + i)) / 100);
    if (c.stabMod !== 4096) d = (d * c.stabMod) / 4096;
    d = Math.floor(pokeRound(d) * c.eff);
    if (c.isBurned) d = Math.floor(d / 2);
    out.push(pokeRound(Math.max(1, (d * finalMod) / 4096)));
  }
  return out;
}

/**
 * What changes between two hits — the library's `checkMultihitBoost` for the
 * effects that exist here: Stamina (+1 Def) / Weak Armor (−1 Def, +2 Spe,
 * White Herb permitting) / Water Compaction (+2 Def) on the target, Seed Sower
 * / Sand Spit re-setting the field, the user's own Atk/SpA drop (Superpower,
 * Draco Meteor…), Gyro Ball / Electro Ball into Gooey / Tangling Hair (−1 Spe),
 * and the Mummy-family ability swap on contact — mirrored literally, so a
 * Parental Bond child into Mummy (Cofagrigus) even loses its ¼, as the library
 * computes it — plus Champions' Spicy Spray burning the user (Showdown's
 * onDamagingHit; the library has no such ability). Mutates `c`.
 */
function betweenHits(c: Ctx, used: { a: boolean; d: boolean }): void {
  let { attacker: a, defender: d } = c;
  const { move, id } = c;
  if ((id === "gyroball" || id === "electroball") && has(d.ability, "Gooey", "Tangling Hair")) {
    if (has(a.item, "White Herb") && !used.a) used.a = true;
    else a = withBoost(a, "spe", Math.max(boostOf(a, "spe") - 1, -6));
  }
  if (has(d.ability, "Seed Sower")) c.terrain = "Grassy";
  if (has(d.ability, "Sand Spit")) {
    c.weather = "Sand";
    if (!has(a.ability, "Mega Sol")) c.moveWeather = "Sand";
  }
  const unaware = has(a.ability, "Unaware");
  if (has(d.ability, "Stamina")) {
    if (!unaware) d = withBoost(d, "def", Math.min(boostOf(d, "def") + 1, 6));
  } else if (has(d.ability, "Water Compaction") && move.type === "water") {
    if (!unaware) d = withBoost(d, "def", Math.min(boostOf(d, "def") + 2, 6));
  } else if (has(d.ability, "Weak Armor")) {
    if (!unaware) {
      if (has(d.item, "White Herb") && !used.d && boostOf(d, "def") === 0) used.d = true;
      else d = withBoost(d, "def", Math.max(boostOf(d, "def") - 1, -6));
    }
    d = withBoost(d, "spe", Math.min(boostOf(d, "spe") + 2, 6));
  }
  const drop = SELF_ATTACK_DROPS[id];
  if (drop && !unaware) {
    const stat: BoostStat = c.physical ? "atk" : "spa";
    const simple = has(a.ability, "Simple") ? 2 : 1;
    let next = has(a.ability, "Contrary") ? Math.min(6, boostOf(a, stat) + drop) : Math.max(-6, boostOf(a, stat) - drop * simple);
    if (has(a.item, "White Herb") && boostOf(a, stat) < 0 && !used.a) {
      next += drop * simple;
      used.a = true;
    }
    a = withBoost(a, stat, next);
  }
  // Champions' Spicy Spray (Mega Scovillain): `onDamagingHit → source.trySetStatus('brn')`
  // fires after EVERY hit, so a multi-hit / Parental Bond user takes its later
  // hits burned — halved if physical (Guts: ×1.5 Atk instead). A Fire type, a
  // status already held, the burn-proof abilities, Leaf Guard in Sun and Misty
  // Terrain under a grounded user stop it; a Lum / Rawst Berry cures it before
  // the next hit (Showdown runs Update between hits), spending the berry.
  if (has(d.ability, "Spicy Spray") && !a.status && !a.types.includes("fire") &&
      !has(a.ability, "Water Veil", "Water Bubble", "Thermal Exchange", "Purifying Salt", "Comatose") &&
      !(has(a.ability, "Leaf Guard") && c.weather === "Sun") && !(c.terrain === "Misty" && isGrounded(a))) {
    if (has(a.item, "Lum Berry", "Rawst Berry")) {
      a = { ...a, item: null };
    } else {
      a = { ...a, status: "brn" };
      c.isBurned = burnHalves(a, c.physical, id);
    }
  }
  if (has(d.ability, "Mummy", "Wandering Spirit", "Lingering Aroma") && move.flags?.includes("contact")) {
    const old = a.ability ?? null;
    a = { ...a, ability: d.ability };
    if (has(d.ability, "Wandering Spirit")) d = { ...d, ability: old };
  }
  // An -ate boost is lost with the ability (the type stays changed).
  if (c.ateBoost && !ATE_TYPE[stripId(a.ability ?? "")] && !has(a.ability, "Normalize")) c.ateBoost = false;
  c.attacker = a;
  c.defender = d;
}

const PB_CHILD = "Parental Bond (Child)";

/**
 * Uses the KO look-ahead walks: "OHKO", "2HKO", "3HKO" — anything later is
 * "4+ HKO". A move that makes its user faint walks ONE ({@link MoveFacts.userFaints}).
 */
const LOOKAHEAD_USES = 3;

/**
 * From one use of the move to the next — what the KO look-ahead (uses 2 and 3)
 * changes, in THIS order. Everything else repeats as-is, as @smogon/calc repeats
 * every use (HP-scaled power — Brine, Hard Press, Eruption — keeps the starting
 * HP; Life Orb / recoil cost the user nothing; Sitrus Berry heals nothing: the
 * library's KO logic models none of these). Mutates `c`.
 *  1. The last hit's after-hit effects — the same {@link betweenHits} that runs
 *     between two hits: the user's own stat drop (SELF_ATTACK_DROPS: Draco
 *     Meteor / Overheat / Leaf Storm / Psycho Boost / Fleur Cannon / Make It Rain
 *     −2, Superpower −1), Stamina / Weak Armor / Water Compaction, Spicy Spray's
 *     burn, Mummy, Seed Sower / Sand Spit, Gooey vs Gyro Ball.
 *  2. Parental Bond's child marker is cleared (each use starts with the parent hit).
 *  3. One-time items are spent: a resist berry that fired, the user's matching
 *     Gem, a Knock Off'd item (not a Mega Stone; Sticky Hold keeps it), an Air
 *     Balloon popped by the hit. (Focus Sash / Sturdy / Disguise / Ice Face are
 *     settled hit by hit in {@link koWalk}.)
 *  4. The target is no longer at full HP: Multiscale / Shadow Shield are gone.
 *  5. Meteor Beam / Electro Shot charge again: another +1 SpA (Simple +2, Contrary −1).
 *  6. STAB and burn are re-read for the new use.
 */
function nextUse(c: Ctx, used: { a: boolean; d: boolean }, parentAbility: string | null): void {
  betweenHits(c, used);
  if (c.attacker.ability === PB_CHILD) c.attacker = { ...c.attacker, ability: parentAbility };
  const type = c.move.type;
  const berry = c.defender.item ? RESIST_BERRIES[stripId(c.defender.item)] : undefined;
  if (berry === type && (c.eff > 1 || type === "normal") &&
      !has(c.attacker.ability, "Unnerve", "As One (Glastrier)", "As One (Spectrier)")) {
    c.defender = { ...c.defender, item: null };
    c.knockItem = null;
  }
  if (c.attacker.item && stripId(c.attacker.item) === `${type}gem`) c.attacker = { ...c.attacker, item: null };
  if (c.id === "knockoff" && c.knockItem && !isMegaStone(c.knockItem) && !has(c.defender.ability, "Sticky Hold")) {
    c.defender = { ...c.defender, item: null };
    c.knockItem = null;
  }
  if (has(c.defender.item, "Air Balloon")) {
    c.defender = { ...c.defender, item: null };
    c.knockItem = null;
  }
  c.dFull = false;
  if (c.id === "meteorbeam" || c.id === "electroshot") {
    const step = has(c.attacker.ability, "Simple") ? 2 : has(c.attacker.ability, "Contrary") ? -1 : 1;
    c.attacker = withBoost(c.attacker, "spa", boostOf(c.attacker, "spa") + step);
  }
  c.stabMod = stabOf(c.attacker, type);
  c.isBurned = burnHalves(c.attacker, c.physical, c.id);
}

/**
 * The KO walk: the exact distribution of the defender's remaining HP, hit by
 * hit, over up to {@link LOOKAHEAD_USES} uses. Every hit draws its OWN roll
 * (16 equally likely values, independent of every other hit — pairing roll i
 * with roll i across hits, as the summed `damage` array does, overstated Twin
 * Beam into 155-HP Heracross as a 50% OHKO; it is 78/256). States are HP 0…hp
 * (0 = KO'd), so 10-hit Population Bomb stays ~hp×16 work per hit. Rules, per hit:
 *  - `block` (Disguise / Ice Face intact): the FIRST hit does no damage; the
 *    defender then loses `block` HP (Disguise: ⅛ max HP, Gen 9; Ice Face: 0).
 *  - `endure` (Focus Sash / Sturdy): a hit that would KO from FULL HP leaves
 *    1 HP instead. Full HP never comes back, so a spent Sash needs no flag,
 *    and a multi-hit move's next hit finishes the job.
 * `lows[k]` / `highs[k]` are the HP left after use k+1 when every hit rolls its
 * max / min (the walk is monotone, so those are the extremes).
 */
function koWalk(useHits: number[][][], hp: number, maxHp: number, endure: boolean, block: number | null) {
  let dist = new Float64Array(hp + 1);
  dist[hp] = 1;
  let lo = hp;
  let hi = hp;
  let pending = block;
  const after = (r: number, d: number): number => (endure && r === maxHp && d >= r ? 1 : Math.max(0, r - d));
  const koChances: number[] = [];
  const lows: number[] = [];
  const highs: number[] = [];
  for (const hits of useHits) {
    for (const rolls of hits) {
      if (pending != null) {
        const chip = pending;
        pending = null;
        if (chip > 0) {
          const next = new Float64Array(hp + 1);
          for (let r = 0; r <= hp; r++) if (dist[r]) next[Math.max(0, r - chip)] += dist[r];
          dist = next;
          lo = Math.max(0, lo - chip);
          hi = Math.max(0, hi - chip);
        }
        continue;
      }
      // Run-length the 16 rolls (typically 6–10 distinct values).
      const values: number[] = [];
      const weights: number[] = [];
      for (const d of rolls) {
        if (values.length && values[values.length - 1] === d) weights[weights.length - 1]++;
        else { values.push(d); weights.push(1); }
      }
      const next = new Float64Array(hp + 1);
      next[0] = dist[0];
      for (let r = 1; r <= hp; r++) {
        const p = dist[r];
        if (!p) continue;
        for (let j = 0; j < values.length; j++) next[after(r, values[j])] += (p * weights[j]) / 16;
      }
      dist = next;
      lo = after(lo, rolls[15]);
      hi = after(hi, rolls[0]);
    }
    koChances.push(dist[0] * 100);
    lows.push(lo);
    highs.push(hi);
  }
  return { koChances, lows, highs };
}

/**
 * Effective priority — what the priority blockers (Armor Tail / Dazzling /
 * Queenly Majesty, Psychic Terrain) AND turn order see: the move's own, +1 for
 * Grassy Glide from a grounded user in Grassy Terrain, +1 for **Gale Wings** on
 * a Flying move (the RESOLVED type) from a user at FULL HP. Showdown's
 * onModifyPriority raises both before the blockers' `priority > 0.1` test;
 * @smogon/calc raises neither (so it let Talonflame's full-HP Brave Bird and
 * Rillaboom's Grassy Glide "hit" Armor Tail Farigiraf — in game both fail).
 */
function priorityOf(move: CalcMove, type: PokemonType, attacker: CalcPokemon, attackerFullHp: boolean, terrain: Terrain): number {
  const id = stripId(move.name);
  let priority = move.priority ?? 0;
  if (id === "grassyglide" && terrain === "Grassy" && isGrounded(attacker)) priority += 1;
  if (has(attacker.ability, "Gale Wings") && type === "flying" && attackerFullHp) priority += 1;
  return priority;
}

/**
 * Compute a full damage roll of `move` from `attacker` into `defender` under
 * `field`. Returns the 16-roll array, %s, the resolved move, and a KO verdict
 * that walks up to three uses with independent rolls and the full-HP survival
 * effects: Focus Sash (item) and Sturdy (ability — Mold Breaker / Teravolt /
 * Turboblaze ignore it, never the Sash) turn a KO from full HP into 1 HP left;
 * Disguise (Mimikyu) blocks the first hit and costs ⅛ max HP; Ice Face blocks
 * the first PHYSICAL hit (Mold Breaker breaks both). "At full HP" is the HP
 * control at 100% — below it, Sash / Sturdy can't fire and Disguise / Ice Face
 * are taken as already broken. `damage` / `minDamage` / `maxDamage` stay the
 * RAW rolls of one use (the @smogon/calc parity surface); the verdict,
 * `hpAfter` and `survival` carry the survival effects.
 */
export function computeDamage(
  attacker: CalcPokemon,
  defender: CalcPokemon,
  move: CalcMove,
  field: CalcField = {},
): DamageResult {
  const gameType = field.gameType ?? "Doubles";
  const isDoubles = gameType !== "Singles";
  const terrain = field.terrain ?? null;
  const id = stripId(move.name);

  // Stance Change (Aegislash), FIRST — every later rule must see the forme that
  // actually swings: a damaging move is used in Blade Forme whichever forme is
  // selected (Showdown's onModifyMove forme change). Defending, the selected
  // forme stands (this branch only ever touches the attacker).
  if (has(attacker.ability, "Stance Change") && attacker.attackForm) {
    attacker = { ...attacker, ...attacker.attackForm };
  }

  // ---- the library's "Initial" region: rewrite the inputs before any math ----
  // Cloud Nine / Air Lock (Altaria, Drampa) switch the weather off for everyone.
  let weather = field.weather ?? null;
  if (has(attacker.ability, "Air Lock", "Cloud Nine") || has(defender.ability, "Air Lock", "Cloud Nine")) {
    weather = null;
  }
  attacker = withForecast(attacker, weather);
  defender = withForecast(defender, weather);
  // Klutz: the holder's item does nothing (no Seed, no Balloon, no berry) — yet
  // it is still THERE for Knock Off, which the library reads off `disabledItem`.
  const dKlutzItem = has(defender.ability, "Klutz") ? defender.item ?? null : null;
  if (has(attacker.ability, "Klutz")) attacker = { ...attacker, item: null };
  if (has(defender.ability, "Klutz")) defender = { ...defender, item: null };
  attacker = withSeedBoost(attacker, terrain);
  defender = withSeedBoost(defender, terrain);
  const knockItem = defender.item ?? dKlutzItem;
  // Meteor Beam / Electro Shot (Archaludon): the charge turn's +1 SpA lands
  // before the hit — the library computes the attacking turn, and so do we.
  if (id === "meteorbeam" || id === "electroshot") {
    const step = has(attacker.ability, "Simple") ? 2 : has(attacker.ability, "Contrary") ? -1 : 1;
    attacker = withBoost(attacker, "spa", boostOf(attacker, "spa") + step);
  }

  const aRaw = rawStats(attacker);
  const dRaw = rawStats(defender);
  const aHp = Math.max(1, Math.floor((aRaw.hp * (attacker.curHpPct ?? 100)) / 100));
  const hp = Math.max(1, Math.floor((dRaw.hp * (defender.curHpPct ?? 100)) / 100));
  const maxHp = dRaw.hp;

  let category = move.category;
  let flags = move.flags ?? [];
  // Shell Side Arm turns physical (and contact) when that hits harder.
  if (id === "shellsidearm") {
    const atk = modifiedStat(aRaw.atk, boostOf(attacker, "atk"));
    const spa = modifiedStat(aRaw.spa, boostOf(attacker, "spa"));
    const def = modifiedStat(dRaw.def, boostOf(defender, "def"));
    const spd = modifiedStat(dRaw.spd, boostOf(defender, "spd"));
    if (atk / def > spa / spd) {
      category = "physical";
      flags = [...flags, "contact"];
    }
  }

  // Screens: Infiltrator walks through them; Brick Break / Psychic Fangs /
  // Raging Bull shatter them before the hit lands.
  let reflect = !!field.reflect;
  let lightScreen = !!field.lightScreen;
  let auroraVeil = !!field.auroraVeil;
  if (has(attacker.ability, "Infiltrator") || id === "brickbreak" || id === "psychicfangs" || id === "ragingbull") {
    reflect = lightScreen = auroraVeil = false;
  }

  // Mold Breaker / Teravolt / Turboblaze: the target's ability is simply not
  // there for this move — Levitate, Multiscale, the Armors, Thick Fat, Fur
  // Coat, Armor Tail, Soundproof, Sturdy, Disguise, Ice Face… (Mega Gyarados,
  // Excadrill, Basculegion). Focus Sash is an ITEM: it still holds.
  if (has(attacker.ability, "Mold Breaker", "Teravolt", "Turboblaze") && defender.ability &&
      MOLD_BREAKER_IGNORES.has(stripId(defender.ability))) {
    defender = { ...defender, ability: null };
  }

  // --- critical hit -------------------------------------------------------------
  // Decided ONCE, before any stat is read, the way @smogon/calc decides it: a
  // forced crit (`field.isCritical`), an always-crit move (Frost Breath, Flower
  // Trick, Storm Throw), or a Merciless attacker into a poisoned target — and
  // NEVER into Battle Armor / Shell Armor, which cancel all three (Mega Slowbro,
  // Torkoal and Perrserker can carry them; Merciless doesn't pierce them, Mold
  // Breaker does — the Armors were blanked just above).
  // Until the 2026-10 re-bake this was `!!field.isCritical` alone, which the UI
  // never sets, so the calc never crit: Mega Froslass's Frost Breath read 2/3 of
  // its real damage (into Rillaboom: a 70–84% "2HKO" that is really a 105–126%
  // guaranteed OHKO). What a crit then changes: 1.5× base damage, the
  // attacker's negative / defender's positive stat stages ignored, screens
  // ignored, Sniper's extra 1.5×.
  const crit = !has(defender.ability, "Battle Armor", "Shell Armor") && (
    !!field.isCritical || alwaysCrits(move.name) ||
    (has(attacker.ability, "Merciless") && (defender.status === "psn" || defender.status === "tox"))
  );

  // --- the move's type ------------------------------------------------------------
  // Mega Sol (Mega Meganium, Champions): the holder's moves act as if the Sun
  // were up whatever the field says — Showdown's `effectiveWeather()` returns
  // 'sunnyday' while it moves, and its WeatherModifyDamage handler applies
  // Sun's ×1.5 Fire / ×0.5 Water and fast-exits before the real weather's.
  // So Weather Ball is a 100-BP Fire move and Solar Beam never halves — even
  // through Cloud Nine (an Ability handler, which Air Lock doesn't suppress).
  const moveWeather: Weather = has(attacker.ability, "Mega Sol") ? "Sun" : weather;
  let type = move.type;
  if (id === "weatherball") {
    type = moveWeather ? WEATHER_BALL_TYPE[moveWeather] : "normal";
  } else if (id === "terrainpulse" && terrain && isGrounded(attacker)) {
    type = TERRAIN_PULSE_TYPE[terrain];
  } else if (id === "ragingbull" && RAGING_BULL_TYPE[attacker.name]) {
    type = RAGING_BULL_TYPE[attacker.name];
  }
  // The -ate family / Dragonize / Normalize / Liquid Voice. Sylveon, Mega
  // Gardevoir and Mega Salamence's Hyper Voice is a Fairy/Flying move here — it
  // used to read Normal, so a Ghost "walled" it and it lost its STAB and 1.2×.
  let ateBoost = false;
  if (!NO_TYPE_CHANGE.has(id)) {
    const ate = ATE_TYPE[stripId(attacker.ability ?? "")];
    if (ate && type === "normal") {
      type = ate;
      ateBoost = true;
    } else if (has(attacker.ability, "Liquid Voice") && flags.includes("sound")) {
      type = "water"; // Primarina's Hyper Voice: Water, but no 1.2×
    } else if (has(attacker.ability, "Normalize")) {
      type = "normal";
      ateBoost = true;
    }
  }
  const expandingForce = terrain === "Psychic" && id === "expandingforce" && isGrounded(attacker);
  const resolved: CalcMove = {
    ...move, type, category, flags,
    // Expanding Force becomes a SPREAD move for a grounded user in Psychic
    // Terrain (its 1.5× is in the BP chain; the ×0.75 then applies like any spread move).
    target: expandingForce ? "all-opponents" : move.target,
  };
  // Targets from the RESOLVED move + this direction's side counts: the ×0.75
  // needs 2+ real targets, Dragon Darts fires one dart per foe.
  const targets = targetsHit(resolved, field);
  const spread = isSpreadHit(resolved, field);

  // --- type effectiveness + immunities ----------------------------------------------
  const ghostRevealed = has(attacker.ability, "Scrappy", "Mind's Eye");
  let eff = 1;
  for (const t of defender.types) {
    let e: number;
    if (ghostRevealed && t === "ghost" && (type === "normal" || type === "fighting")) e = 1;
    else if (id === "freezedry" && t === "water") e = 2; // Freeze-Dry: always 2× on Water
    else {
      e = TYPE_CHART[type][t] ?? 1;
      if (id === "flyingpress") e *= TYPE_CHART.flying[t] ?? 1; // Fighting AND Flying at once
    }
    eff *= e;
  }
  // An Iron Ball drags a Flying type into Ground's reach (the library's rule: a
  // zero becomes neutral).
  if (eff === 0 && type === "ground" && has(defender.item, "Iron Ball")) eff = 1;

  const multiHit = isMultiHitMove(resolved);
  const hits = has(attacker.ability, "Parental Bond") && !multiHit && !spread ? 2 : hitCount(resolved, attacker, targets);
  const physical = category === "physical";
  // Effective priority, decided before any blocker reads it (see priorityOf).
  const priority = priorityOf(move, type, attacker, aHp === aRaw.hp, terrain);

  const c: Ctx = {
    attacker, defender, move: resolved, id, physical,
    weather, moveWeather, terrain, isDoubles, spread,
    helpingHand: !!field.helpingHand, reflect, lightScreen, auroraVeil, friendGuard: !!field.friendGuard,
    crit, eff, ateBoost, expandingForce, knockItem, aRaw, dRaw, aHp, dHp: hp,
    dFull: hp === maxHp, aTailwind: !!field.attackerTailwind, dTailwind: !!field.defenderTailwind,
    stabMod: stabOf(attacker, type), isBurned: burnHalves(attacker, physical, id),
  };
  const fixedDamage = id === "seismictoss" || id === "nightshade" || id === "finalgambit";
  // The user faints: this use is the only one the verdict may count.
  const userFaints = id === "explosion" || id === "selfdestruct" || id === "mistyexplosion" || id === "finalgambit";
  const facts: MoveFacts = {
    type, category, spread, targets, priority, hits,
    basePower: fixedDamage ? null : basePowerOf(c, 1, false, movesLastOf(c)),
    userFaints,
  };

  const blank = (why: string | null, immune: boolean): DamageResult => ({
    damage: new Array(16).fill(0), minDamage: 0, maxDamage: 0, hp, maxHp,
    minPct: 0, maxPct: 0, typeEffectiveness: eff, immune, fails: why, hits,
    verdict: { label: why ? "Fails" : "No effect", guaranteed: false, ohkoChance: 0, koChances: [0, 0, 0] },
    move: facts, survival: null, hpAfter: { min: hp, max: hp },
    uses: Array.from({ length: LOOKAHEAD_USES }, () => ({ min: 0, max: 0 })),
  });
  if (eff === 0) return blank(null, true);
  // Moves that fail before any damage is rolled — the library's early returns.
  // Steel Roller topped Mega Metagross's sets once Indeedee-F's Psychic Surge
  // took over Reg M-C, which is how this surfaced: the engine used to roll full
  // damage with no terrain up.
  if (id === "steelroller" && !terrain) return blank("needs a terrain up", false);
  if (id === "poltergeist" && !defender.item) return blank("target holds no item", false);

  const dAb = defender.ability ? stripId(defender.ability) : "";
  if ((dAb === "wonderguard" && eff <= 1) ||
      (dAb && IMMUNITY[dAb] === type) ||
      (type === "ground" && !has(defender.item, "Iron Ball") && has(defender.ability, "Levitate", "Eelevate")) ||
      (flags.includes("bullet") && dAb === "bulletproof") ||
      (flags.includes("sound") && id !== "clangoroussoul" && dAb === "soundproof") ||
      (flags.includes("wind") && dAb === "windrider")) {
    return blank(null, true);
  }
  // Farigiraf's Armor Tail (#8 in Reg M-C) — Fake Out, Sucker Punch, Grassy
  // Glide in Grassy Terrain, a full-HP Gale Wings Brave Bird and every other
  // priority move simply fail into it. As do Queenly Majesty / Dazzling.
  if (priority > 0 && has(defender.ability, ...PRIORITY_BLOCKERS)) {
    return blank(`${defender.ability} blocks priority`, false);
  }
  // Air Balloon (v1.2.0): Ground moves miss the holder entirely, same as
  // Levitate — a hard immunity, so the calc reports "immune", not "0 damage".
  if (type === "ground" && has(defender.item, "Air Balloon")) return blank(null, true);
  if (priority > 0 && terrain === "Psychic" && isGrounded(defender)) {
    return blank("Psychic Terrain blocks priority", false);
  }

  // --- the rolls: use 1 hit by hit, then the look-ahead uses ----------------------
  const pb = hits === 2 && has(attacker.ability, "Parental Bond") && !multiHit;
  const parentAbility = attacker.ability ?? null;
  const used = { a: false, d: false };
  const rollUse = (): number[][] => {
    if (fixedDamage) {
      // Fixed damage: the user's level (50) / its current HP. Parental Bond: twice.
      const amount = id === "finalgambit" ? aHp : 50;
      const n = id !== "finalgambit" && hits === 2 ? 2 : 1;
      return Array.from({ length: n }, () => new Array(16).fill(amount));
    }
    const out = [rollHit(c, 1, false)];
    for (let k = 2; k <= hits; k++) {
      if (pb) c.attacker = { ...c.attacker, ability: PB_CHILD };
      betweenHits(c, used);
      // The library recomputes the child as a whole fresh calc (STAB and burn
      // re-read with the child's ability): its base damage is cut to ¼ only
      // while it still IS the child.
      const child = pb && c.attacker.ability === PB_CHILD;
      if (pb) {
        c.stabMod = stabOf(c.attacker, type);
        c.isBurned = burnHalves(c.attacker, c.physical, id);
      }
      out.push(rollHit(c, pb ? 1 : k, child));
    }
    return out;
  };
  const useHits: number[][][] = [rollUse()];
  for (let u = 2; u <= LOOKAHEAD_USES; u++) {
    // The user fainted: no later use — an empty one leaves the KO walk where it was.
    if (userFaints) {
      useHits.push([]);
      continue;
    }
    nextUse(c, used, parentAbility);
    useHits.push(rollUse());
  }
  // One use's 16 "rolls" as @smogon/calc folds a multi-hit move: hit i's roll k
  // summed over i — the parity surface, and min/max = the sum of the hits' mins/maxes.
  const first = useHits[0];
  const damage = first[0].map((_, k) => first.reduce((sum, h) => sum + h[k], 0)).sort((x, y) => x - y);
  const minDamage = damage[0];
  const maxDamage = damage[15];

  // --- survival effects at full HP + the KO walk -------------------------------------
  const fullHp = hp === maxHp;
  const sash = fullHp && has(defender.item, "Focus Sash");
  const sturdy = fullHp && has(defender.ability, "Sturdy");
  const block = !fullHp ? null
    : has(defender.ability, "Disguise") ? Math.max(1, Math.floor(maxHp / 8))
      : has(defender.ability, "Ice Face") && physical ? 0 : null;
  const walk = koWalk(useHits, hp, maxHp, sash || sturdy, block);
  let survival: Survival | null = null;
  if (block != null) {
    survival = has(defender.ability, "Disguise")
      ? { kind: "disguise", label: `Disguise blocks hit 1 (−${block} HP)` }
      : { kind: "ice-face", label: "Ice Face blocks hit 1" };
  } else if ((sash || sturdy) && first[0][15] >= hp) {
    const name = sturdy ? "Sturdy" : "Focus Sash";
    survival = { kind: sturdy ? "sturdy" : "focus-sash", label: first.length > 1 ? `${name} — hit 1 leaves 1 HP` : `${name} — survives at 1 HP` };
  }

  // A user-fainting move has one use: anything past it is "No KO".
  const label = (n: number) => (n <= 1 ? "OHKO" : userFaints ? "No KO" : n >= 4 ? "4+ HKO" : `${n}HKO`);
  // Fewest uses = every hit at its top roll; guaranteed = every hit at its lowest.
  const best = label(walk.lows.indexOf(0) + 1 || 4);
  const worst = label(walk.highs.indexOf(0) + 1 || 4);
  // Both ends can collapse to one label — "5HKO–7HKO" is just "4+ HKO" — and
  // a range of two identical labels ("4+ HKO–4+ HKO", 1962 of the 4848 golden
  // fixture cases until 2026-11-18) is noise, so the label alone is emitted.
  // A user-fainting move's "OHKO–No KO" is just a partial "OHKO" (its chance says the rest).
  const verdict: KoVerdict = best === worst
    ? { label: best, guaranteed: true, ohkoChance: walk.koChances[0], koChances: walk.koChances }
    : { label: userFaints ? best : `${best}–${worst}`, guaranteed: false, ohkoChance: walk.koChances[0], koChances: walk.koChances };

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
    fails: null,
    hits,
    verdict,
    move: facts,
    survival,
    hpAfter: { min: walk.lows[0], max: walk.highs[0] },
    uses: useHits.map((hs) => ({
      min: hs.reduce((sum, h) => sum + h[0], 0),
      max: hs.reduce((sum, h) => sum + h[15], 0),
    })),
  };
}

/**
 * Both combatants' EFFECTIVE Speed — what turn order compares: the same chain
 * the damage rolls use (`finalSpeed`: stages, Tailwind, weather/terrain speed
 * abilities, Quick Feet, Choice Scarf / Iron Ball, paralysis), with Cloud Nine /
 * Air Lock clearing the weather for both. `a` sits on the attacker's side
 * (`field.attackerTailwind`), `b` on the defender's.
 */
export function effectiveSpeeds(a: CalcPokemon, b: CalcPokemon, field: CalcField = {}): { a: number; b: number } {
  const noWeather = has(a.ability, "Air Lock", "Cloud Nine") || has(b.ability, "Air Lock", "Cloud Nine");
  const weather = noWeather ? null : field.weather ?? null;
  const terrain = field.terrain ?? null;
  return {
    a: finalSpeed(a, rawStats(a).spe, weather, terrain, !!field.attackerTailwind),
    b: finalSpeed(b, rawStats(b).spe, weather, terrain, !!field.defenderTailwind),
  };
}

/**
 * Who moves first: the higher EFFECTIVE priority (`DamageResult.move.priority`)
 * goes first; within a priority bracket the faster effective Speed — reversed
 * under Trick Room — and equal Speed is a tie (a coin flip in game).
 */
export function turnOrder(
  a: { speed: number; priority: number },
  b: { speed: number; priority: number },
  trickRoom = false,
): "a" | "b" | "tie" {
  if (a.priority !== b.priority) return a.priority > b.priority ? "a" : "b";
  if (a.speed === b.speed) return "tie";
  return (a.speed > b.speed) !== trickRoom ? "a" : "b";
}

/**
 * Reduce a full {@link MoveSummary} to the calc's move shape. Returns null for
 * status moves and the null-power moves the engine can't resolve (Counter,
 * Fissure, Endeavor, Fling, …) — the UI shows those as "not calculated" rather
 * than guessing.
 */
export function moveToCalcMove(m: Pick<MoveSummary,
  "displayName" | "type" | "damageClass" | "power" | "target" | "flags" |
  "ailment" | "ailmentChance" | "statChance" | "statChanges" | "flinchChance" |
  "minHits" | "maxHits" | "priority">): CalcMove | null {
  const cls: DamageClass = m.damageClass;
  if (cls === "status") return null;
  const category = cls === "physical" ? "physical" : "special";
  // Variable-power moves (Grass Knot, Heavy Slam, Flail, Seismic Toss…) carry
  // power: null (Hard Press: 0); the ones we can model resolve at compute time.
  if (!m.power) {
    const id = stripId(m.displayName);
    if (!VARIABLE_MOVES.has(id)) return null;
    return {
      name: m.displayName, type: m.type, category, basePower: 0, variablePower: id,
      target: m.target, flags: m.flags ?? [], hasSecondary: hasSecondaryEffect(m),
      minHits: m.minHits, maxHits: m.maxHits, priority: m.priority,
    };
  }
  return {
    name: m.displayName,
    type: m.type,
    category,
    basePower: m.power,
    target: m.target,
    flags: m.flags ?? [],
    hasSecondary: hasSecondaryEffect(m),
    minHits: m.minHits,
    maxHits: m.maxHits,
    priority: m.priority,
  };
}
