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

export type RoleTone =
  | "speed"
  | "redirect"
  | "weather"
  | "intimidate"
  | "fakeout"
  | "screen"
  | "priority"
  | "pivot";

export interface DoublesRole {
  label: string;
  tone: RoleTone;
  /** "Move" | "Ability" | "Strategy" — shown as the modal's category. */
  kind: string;
  /** Doubles-focused overview of what it does, for the tap-through modal. */
  desc: string;
}

const WEATHER: Record<string, { label: string; desc: string }> = {
  drought: {
    label: "Sun",
    desc: "Harsh sunlight on switch-in (Drought): Fire moves hit 1.5×, Water is weakened, Solar Beam fires instantly, and Chlorophyll doubles Speed. Expect heavy Fire pressure and fast sun abusers.",
  },
  drizzle: {
    label: "Rain",
    desc: "Rain on switch-in (Drizzle): Water moves hit 1.5×, Fire is weakened, Thunder and Hurricane never miss, and Swift Swim doubles Speed. Expect strong Water spam and rain-fast sweepers.",
  },
  sandstream: {
    label: "Sandstorm",
    desc: "A sandstorm (Sand Stream): chip damage every turn to anything that isn't Rock, Ground, or Steel, plus a 1.5× Sp. Def boost for Rock types. Supports sand abusers and chip-based stall.",
  },
  snowwarning: {
    label: "Snow",
    desc: "Snow on switch-in (Snow Warning): Ice types get 1.5× Defense, and it unlocks Aurora Veil (both screens at once) and Slush Rush (2× Speed). Expect bulky Ice cores sitting behind screens.",
  },
};

// Pivot moves — slug, display name, and what each one does.
const PIVOT_MOVES: { slug: string; label: string; desc: string }[] = [
  {
    slug: "u-turn",
    label: "U-turn",
    desc: "A Bug-type attack that deals damage and then immediately switches the user out — keeping momentum and bringing in a better matchup for free. Expect a switch right after it fires.",
  },
  {
    slug: "volt-switch",
    label: "Volt Switch",
    desc: "An Electric-type attack that deals damage and then switches the user out — free momentum and matchup control. Expect a switch right after (it fails into Ground types and Volt Absorb / Lightning Rod).",
  },
  {
    slug: "flip-turn",
    label: "Flip Turn",
    desc: "A Water-type attack that deals damage and then switches the user out — damage plus repositioning in a single move. Expect a switch right after.",
  },
  {
    slug: "parting-shot",
    label: "Parting Shot",
    desc: "Lowers the target's Attack AND Sp. Atk by one stage, then switches the user out — it weakens a foe and brings in a teammate for free. A soft Intimidate with built-in momentum.",
  },
];

// Strong priority attacking moves — slug, display name, and what each one does.
// The tag names whichever one this Pokémon actually runs.
const PRIORITY_MOVES: { slug: string; label: string; desc: string }[] = [
  {
    slug: "extreme-speed",
    label: "Extreme Speed",
    desc: "A +2 priority Normal-type attack — it strikes before almost everything, even most other priority moves. Lets this Pokémon revenge-kill weakened or faster threats and punch straight through Tailwind / Trick Room speed control.",
  },
  {
    slug: "aqua-jet",
    label: "Aqua Jet",
    desc: "A priority Water-type attack that moves before normal-speed moves — used to pick off weakened or faster foes regardless of the Speed stat.",
  },
  {
    slug: "bullet-punch",
    label: "Bullet Punch",
    desc: "A priority Steel-type attack that strikes first — a reliable finisher that's especially strong into Fairy, Ice, and Rock types.",
  },
  {
    slug: "mach-punch",
    label: "Mach Punch",
    desc: "A priority Fighting-type attack that goes first — cleans up weakened foes regardless of the Speed stat.",
  },
  {
    slug: "sucker-punch",
    label: "Sucker Punch",
    desc: "A priority Dark-type attack — but it only works if the target uses an attacking move that turn. Punishes attackers; it fails if they go for status, Protect, or a switch.",
  },
  {
    slug: "shadow-sneak",
    label: "Shadow Sneak",
    desc: "A priority Ghost-type attack that strikes first — used to chip or finish faster foes, and it hits Ghost and Psychic types hard.",
  },
  {
    slug: "ice-shard",
    label: "Ice Shard",
    desc: "A priority Ice-type attack that goes first — ideal for revenge-killing fast Dragon, Flying, and Grass types.",
  },
  {
    slug: "grassy-glide",
    label: "Grassy Glide",
    desc: "A Grass-type attack that gains priority while Grassy Terrain is up — a major tempo tool on terrain teams (Rillaboom and friends).",
  },
  {
    slug: "accelerock",
    label: "Accelerock",
    desc: "A priority Rock-type attack that strikes first — revenge-kills fast Fire, Flying, Bug, and Ice types.",
  },
  {
    slug: "jet-punch",
    label: "Jet Punch",
    desc: "A priority Water-type attack that goes first — a reliable chip/finisher that ignores the Speed stat.",
  },
  {
    slug: "first-impression",
    label: "First Impression",
    desc: "A high-priority Bug-type attack with big power — but it only works the turn the user switches in. A huge opening hit.",
  },
  {
    slug: "vacuum-wave",
    label: "Vacuum Wave",
    desc: "A priority Fighting-type special attack that strikes first — finishes weakened foes regardless of the Speed stat.",
  },
  {
    slug: "water-shuriken",
    label: "Water Shuriken",
    desc: "A priority Water-type move that hits 2–5 times — it goes first and breaks Substitute and Focus Sash (great on Greninja).",
  },
];

/**
 * At-a-glance doubles archetypes derived from how the Pokémon is actually run —
 * the things that define how a turn plays out (speed control, redirection,
 * Fake Out, Intimidate, weather).
 */
export function getDoublesRoles(comp: CompetitiveProfile): DoublesRole[] {
  const mu = comp.moveUsage;
  const au = comp.abilityUsage;
  const mv = (s: string) => mu[s] ?? 0;
  const roles: DoublesRole[] = [];

  if (mv("fake-out") >= 20)
    roles.push({
      label: "Fake Out",
      tone: "fakeout",
      kind: "Move",
      desc: "A priority Normal-type move that strikes first and makes the target flinch — but only the turn the user switches in. In doubles it buys a free turn: while a threat is flinched, the partner sets up, attacks, or puts up screens. Classic lead pressure (Incineroar, Rillaboom, etc.).",
    });
  // Name the actual redirection move it runs (whichever it leans on).
  const followMe = mv("follow-me");
  const ragePowder = mv("rage-powder");
  if (followMe + ragePowder >= 15)
    roles.push({
      label: ragePowder > followMe ? "Rage Powder" : "Follow Me",
      tone: "redirect",
      kind: "Move",
      desc:
        "Redirects all opposing single-target attacks onto this Pokémon for the turn, shielding its partner — used to protect a frail setup sweeper or restricted attacker while it does its job." +
        (ragePowder > followMe
          ? " Rage Powder is blocked by Grass types and Safety Goggles / Overcoat holders."
          : ""),
    });
  if (mv("trick-room") >= 15)
    roles.push({
      label: "Trick Room",
      tone: "speed",
      kind: "Strategy",
      desc: "Reverses turn order for 5 turns so the SLOWEST Pokémon move first. Built around deliberately slow, bulky attackers that would normally be outsped. Against it your fast Pokémon become liabilities — KO the setter, stall out the 5 turns, or set your own Trick Room to flip it back.",
    });
  if (mv("tailwind") >= 15)
    roles.push({
      label: "Tailwind",
      tone: "speed",
      kind: "Strategy",
      desc: "Doubles the Speed of the user's entire team for 4 turns — the main form of doubles speed control. A slower team suddenly moves first; respect the 4-turn window, or set your own Tailwind to match.",
    });
  // Name the actual screen it sets — Aurora Veil, both screens, or a single one.
  const reflect = mv("reflect");
  const lightScreen = mv("light-screen");
  const auroraVeil = mv("aurora-veil");
  if (reflect + lightScreen + auroraVeil >= 15) {
    let label: string;
    let kind = "Move";
    let desc: string;
    if (auroraVeil >= reflect && auroraVeil >= lightScreen) {
      label = "Aurora Veil";
      desc =
        "Sets both Reflect AND Light Screen at once for 5 turns — but only while snow is up. Halves both physical and special damage, letting the team set up and tank hits. Brick Break / Defog-style removal or just brute force gets through.";
    } else if (reflect >= 20 && lightScreen >= 20) {
      label = "Dual Screens";
      kind = "Strategy";
      desc =
        "Sets both Reflect (halves physical) and Light Screen (halves special) for 5 turns, blunting the whole team's incoming damage so it can set up. Brick Break / Defog-style removal or brute force gets through.";
    } else if (reflect >= lightScreen) {
      label = "Reflect";
      desc =
        "Halves incoming PHYSICAL damage for the whole team for 5 turns — cushions physical attackers while the team sets up or stays healthy.";
    } else {
      label = "Light Screen";
      desc =
        "Halves incoming SPECIAL damage for the whole team for 5 turns — cushions special attackers while the team sets up or stays healthy.";
    }
    roles.push({ label, tone: "screen", kind, desc });
  }
  // Name the actual pivot move it leans on, rather than a generic "Pivot".
  const pivotTotal = PIVOT_MOVES.reduce((sum, p) => sum + mv(p.slug), 0);
  if (pivotTotal >= 15) {
    const top = PIVOT_MOVES.reduce((a, b) => (mv(b.slug) > mv(a.slug) ? b : a));
    roles.push({ label: top.label, tone: "pivot", kind: "Move", desc: top.desc });
  }
  // Name the actual priority move it leans on, rather than a generic "Priority".
  const priorityTotal = PRIORITY_MOVES.reduce((sum, m) => sum + mv(m.slug), 0);
  if (priorityTotal >= 20) {
    const top = PRIORITY_MOVES.reduce((a, b) => (mv(b.slug) > mv(a.slug) ? b : a));
    roles.push({ label: top.label, tone: "priority", kind: "Move", desc: top.desc });
  }
  if ((au.intimidate ?? 0) >= 30)
    roles.push({
      label: "Intimidate",
      tone: "intimidate",
      kind: "Ability",
      desc: "On switch-in, drops BOTH opposing Pokémon's Attack by one stage, instantly softening physical attackers — a cornerstone of doubles defense (Incineroar and friends). Special attackers ignore it, and Defiant / Competitive holders actually gain a boost from it.",
    });
  for (const [ability, info] of Object.entries(WEATHER)) {
    if ((au[ability] ?? 0) >= 30)
      roles.push({
        label: info.label,
        tone: "weather",
        kind: "Ability",
        desc: info.desc,
      });
  }
  return roles;
}

export const ROLE_TONE: Record<RoleTone, string> = {
  speed: "#5cc6ef",
  redirect: "#ec8fe6",
  weather: "#67d693",
  intimidate: "#ff8079",
  fakeout: "#f4d23c",
  screen: "#b49cf0",
  priority: "#ff9f5c",
  pivot: "#5fd0c0",
};

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

/** Apply active speed modifiers the way the game does — flooring at each step. */
export function applySpeedMods(speed: number, active: ReadonlySet<string>): number {
  let out = speed;
  for (const mod of SPEED_MODS) {
    if (active.has(mod.id)) out = Math.floor(out * mod.mult);
  }
  return out;
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
