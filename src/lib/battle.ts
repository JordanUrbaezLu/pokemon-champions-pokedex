import { natureEffect } from "./format";
import type {
  CompetitiveProfile,
  CompetitiveSpread,
  EvStat,
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
