import { natureEffect } from "./format";
import type {
  CompetitiveProfile,
  CompetitiveSpread,
  EvStat,
  PokemonAbility,
  PokemonStats,
} from "./types";

const EV_KEY: Record<keyof PokemonStats, EvStat | null> = {
  hp: "hp",
  attack: "atk",
  defense: "def",
  specialAttack: "spa",
  specialDefense: "spd",
  speed: "spe",
  total: null,
};
const NATURE_KEY: Partial<Record<keyof PokemonStats, string>> = {
  attack: "Atk",
  defense: "Def",
  specialAttack: "SpA",
  specialDefense: "SpD",
  speed: "Spe",
};

/**
 * Each stat's actual value at Level 50 (doubles is played at L50) for the common
 * spread — assumes 31 IVs. Lets a trainer read real bulk/speed without doing the
 * EV math mid-battle. Falls back to 0 EVs / neutral nature when no spread is known.
 */
export function lv50Stats(
  stats: PokemonStats,
  spread: CompetitiveSpread | null | undefined,
): Record<keyof PokemonStats, number> {
  const eff = spread ? natureEffect(spread.nature) : null;
  const out = {} as Record<keyof PokemonStats, number>;
  for (const key of ["hp", "attack", "defense", "specialAttack", "specialDefense", "speed"] as const) {
    const base = stats[key];
    const evKey = EV_KEY[key];
    const ev = (evKey && spread?.evs[evKey]) || 0;
    const core = Math.floor(((2 * base + 31 + Math.floor(ev / 4)) * 50) / 100);
    if (key === "hp") {
      out[key] = core + 50 + 10;
    } else {
      const natKey = NATURE_KEY[key];
      const mult = eff?.up === natKey ? 1.1 : eff?.down === natKey ? 0.9 : 1;
      out[key] = Math.floor((core + 5) * mult);
    }
  }
  out.total = stats.total;
  return out;
}

/** Short tag for a spread move's targeting, for the move row. null = single-target. */
export function spreadTag(target: string | null): string | null {
  if (target === "all-other-pokemon") return "Spread"; // both foes + your ally
  if (target === "all-opponents") return "Both foes";
  return null;
}

// --- Ability traps -------------------------------------------------------------
// Abilities that punish a STANDARD doubles play (Intimidate, Icy Wind, Fake Out,
// Earthquake, priority, status…). Surfacing these prevents the canonical
// game-losing misclicks. Keyed by stripped ability id (the abilityUsage keys).

const stripId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface TrapWarning {
  /** stripped ability id */
  id: string;
  /** ability display name, from the Pokémon's own ability list */
  label: string;
  /** the one-line "your usual play backfires" warning */
  warning: string;
  /** red = a standard play actively backfires; amber = a standard play fizzles */
  tone: "red" | "amber";
  /** ladder usage % for this ability, when known (null = no ladder read) */
  pct: number | null;
}

const TRAP_ABILITIES: Record<string, { warning: string; tone: "red" | "amber" }> = {
  defiant: { warning: "Stat drops give it +2 Atk — Intimidate / Icy Wind backfire", tone: "red" },
  competitive: { warning: "Stat drops give it +2 SpA — Intimidate / Icy Wind backfire", tone: "red" },
  guarddog: { warning: "Intimidate RAISES its Attack; it can't be forced out", tone: "red" },
  mirrorarmor: { warning: "Bounces stat drops back — Intimidate / Icy Wind hit YOU", tone: "red" },
  levitate: { warning: "Immune to Ground — Earthquake does nothing", tone: "red" },
  lightningrod: { warning: "Absorbs Electric moves (even your ally's) for +1 SpA", tone: "red" },
  stormdrain: { warning: "Absorbs Water moves (even your ally's) for +1 SpA", tone: "red" },
  voltabsorb: { warning: "Heals from Electric moves", tone: "red" },
  waterabsorb: { warning: "Heals from Water moves", tone: "red" },
  dryskin: { warning: "Heals from Water moves (but takes extra Fire)", tone: "amber" },
  flashfire: { warning: "Immune to Fire — and your Fire move powers it up", tone: "red" },
  sapsipper: { warning: "Absorbs Grass moves for +1 Atk", tone: "red" },
  motordrive: { warning: "Absorbs Electric moves for +1 Spe", tone: "red" },
  eartheater: { warning: "Heals from Ground moves — Earthquake feeds it", tone: "red" },
  wellbakedbody: { warning: "Immune to Fire — gains +2 Def from it", tone: "red" },
  goodasgold: { warning: "Immune to status moves — Spore, Will-O-Wisp, Taunt all fail", tone: "red" },
  magicbounce: { warning: "Bounces status moves back at you", tone: "red" },
  innerfocus: { warning: "Can't flinch (Fake Out fizzles) and ignores Intimidate", tone: "amber" },
  owntempo: { warning: "Ignores Intimidate; can't be confused", tone: "amber" },
  oblivious: { warning: "Ignores Intimidate; can't be Taunted", tone: "amber" },
  scrappy: { warning: "Ignores Intimidate; its Normal/Fighting moves hit Ghosts", tone: "amber" },
  clearbody: { warning: "Stats can't be lowered — Intimidate / Icy Wind do nothing", tone: "amber" },
  whitesmoke: { warning: "Stats can't be lowered — Intimidate / Icy Wind do nothing", tone: "amber" },
  fullmetalbody: { warning: "Stats can't be lowered — Intimidate / Icy Wind do nothing", tone: "amber" },
  hypercutter: { warning: "Attack can't be lowered — ignores Intimidate", tone: "amber" },
  rattled: { warning: "Intimidate (and Bug/Dark/Ghost hits) give it +1 Spe", tone: "amber" },
  justified: { warning: "Dark moves give it +1 Atk", tone: "amber" },
  steamengine: { warning: "Fire or Water moves give it +6 Spe", tone: "red" },
  soundproof: { warning: "Immune to sound moves — Hyper Voice, Snarl fail", tone: "amber" },
  bulletproof: { warning: "Immune to ball/bomb moves — Shadow Ball, Sludge Bomb fail", tone: "amber" },
  queenlymajesty: { warning: "Blocks priority moves — Fake Out, Sucker Punch fail", tone: "red" },
  dazzling: { warning: "Blocks priority moves — Fake Out, Sucker Punch fail", tone: "red" },
  armortail: { warning: "Blocks priority moves — Fake Out, Sucker Punch fail", tone: "red" },
  disguise: { warning: "The first hit breaks Disguise instead of dealing damage", tone: "amber" },
  multiscale: { warning: "Takes half damage at full HP — hard to OHKO", tone: "amber" },
  shadowshield: { warning: "Takes half damage at full HP — hard to OHKO", tone: "amber" },
  stamina: { warning: "Every hit gives it +1 Def", tone: "amber" },
  berserk: { warning: "Dropping it below half HP gives it +1 SpA", tone: "amber" },
  waterbubble: { warning: "Takes half Fire damage; can't be burned", tone: "amber" },
  purifyingsalt: { warning: "Can't be statused; takes half Ghost damage", tone: "amber" },
  thermalexchange: { warning: "Fire moves give it +1 Atk; can't be burned", tone: "amber" },
  unaware: { warning: "Ignores your stat boosts when it attacks or defends", tone: "amber" },
  contrary: { warning: "Reverses stat changes — Intimidate / Icy Wind / any drop BOOSTS it", tone: "red" },
  sturdy: { warning: "Survives any OHKO from full HP (hangs on at 1 HP) — needs chip or a second hit", tone: "amber" },
  static: { warning: "Contact may paralyze you — a physical hit can cost you your Speed", tone: "amber" },
  flamebody: { warning: "Contact may burn you — halving your physical attacker", tone: "amber" },
  poisonpoint: { warning: "Contact may poison you", tone: "amber" },
  roughskin: { warning: "Contact chips your attacker every hit", tone: "amber" },
  ironbarbs: { warning: "Contact chips your attacker every hit", tone: "amber" },
  effectspore: { warning: "Contact may poison, paralyze, or put you to sleep", tone: "amber" },
};

// --- Speed math ----------------------------------------------------------------

/**
 * Lv-50 Speed anchors. Champions fixes IVs at 31 and doubles is played at L50,
 * so MAX (252 EVs, +Spe nature) and MIN (0 EVs, −Spe nature) are provable
 * bounds, not estimates; COMMON is the ladder's most-used spread.
 */
export function speedAnchors(
  stats: PokemonStats,
  spread: CompetitiveSpread | null | undefined,
): { max: number; common: number | null; min: number } {
  return {
    max: lv50Stats(stats, { nature: "Timid", evs: { spe: 252 } }).speed,
    common: spread ? lv50Stats(stats, spread).speed : null,
    min: lv50Stats(stats, { nature: "Brave", evs: {} }).speed,
  };
}

export interface SpeedMod {
  id: string;
  /** spelled out — trainers read names, not codes */
  label: string;
  /** the effect, shown as a quiet suffix ("×1.5", "−1 stage") */
  effect: string;
  mult: number;
}

/** One-tap in-battle Speed modifiers, in the order the game applies them. */
export const SPEED_MODS: SpeedMod[] = [
  { id: "icywind", label: "Icy Wind", effect: "−1", mult: 2 / 3 },
  { id: "scarf", label: "Choice Scarf", effect: "×1.5", mult: 1.5 },
  { id: "tailwind", label: "Tailwind", effect: "×2", mult: 2 },
  { id: "para", label: "Paralysis", effect: "×½", mult: 0.5 },
];

// Gen 6+ multiplier modifiers (Choice Scarf, Tailwind, paralysis) are combined
// into ONE chained multiplier in Q12 (4096) fixed point and applied once — not
// floored independently — so an odd Speed keeps the half a sequential floor
// would drop (101 with Scarf + Tailwind → 303, not floor(floor(101×1.5)×2)=302).
// Icy Wind is a −1 STAT STAGE, applied (floored, ×2/3) before the chain.
const SPEED_MOD_Q12: Record<string, number> = {
  scarf: 0x1800, // ×1.5
  tailwind: 0x2000, // ×2
  para: 0x800, // ×0.5 (gen 7+)
};

/** Apply active speed modifiers the way the game does (see SPEED_MOD_Q12). */
export function applySpeedMods(speed: number, active: ReadonlySet<string>): number {
  const out = active.has("icywind") ? Math.floor((speed * 2) / 3) : speed;
  let chain = 0x1000;
  for (const id of ["scarf", "tailwind", "para"]) {
    if (active.has(id)) chain = (chain * SPEED_MOD_Q12[id] + 0x800) >> 12;
  }
  return (out * chain + 0x800) >> 12;
}

/**
 * The ability traps this form can spring, weighted by ladder usage when known.
 * Traps are intrinsic to the ability — they're worth a warning even with no
 * ladder data — but the % tells you "likely" vs "possible".
 */
export function getTrapWarnings(
  abilities: PokemonAbility[],
  comp?: CompetitiveProfile | null,
): TrapWarning[] {
  const out: TrapWarning[] = [];
  for (const a of abilities) {
    const id = stripId(a.name);
    const trap = TRAP_ABILITIES[id];
    if (!trap) continue;
    const pct = comp?.abilityUsage?.[id] ?? null;
    // Skip abilities the ladder shows are essentially never run.
    if (pct != null && pct < 5) continue;
    out.push({ id, label: a.displayName, warning: trap.warning, tone: trap.tone, pct });
  }
  return out.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
}
