import { lv50Stats, getTrapWarnings } from "./battle";
import type {
  CompetitiveProfile,
  MoveSummary,
  PokemonAbility,
  PokemonStats,
  PokemonType,
} from "./types";

/**
 * The Threat Profile engine: reads a form's ladder data and answers "what
 * makes THIS Pokémon dangerous?" — not a fixed template, but a ranked set of
 * threat vectors, each fired only when the data supports it:
 *
 *  - set-up sweeps, with the post-boost stats actually computed
 *  - raw damage, ranked as a PERCENTILE against the whole Champions meta
 *  - speed control (Trick Room / Tailwind / speed drops / paralysis)
 *  - priority revenge-killing
 *  - disruption (sleep, Fake Out, redirection, Intimidate, item theft…)
 *  - field control (weather, screens)
 *  - ability traps (Defiant, Levitate, absorb abilities…)
 *  - tank profiles (meta-percentile bulk + recovery)
 *  - raw speed tiers (incl. the Scarf read)
 *
 * Built for a 40-second turn clock: every vector is a short colored headline,
 * a one-line detail, and ONE big right-rail number with a caption — so the
 * card scans top-to-bottom in a second. Everything is computed at build time
 * on the server; the page ships only the finished vectors.
 */

export type ThreatKind =
  | "setup"
  | "nuke"
  | "speed-control"
  | "priority"
  | "disruption"
  | "field"
  | "trap"
  | "wall"
  | "speed"
  | "baseline";

export interface ThreatVector {
  kind: ThreatKind;
  /** Short, concrete, scannable: "One Swords Dance from sweeping". */
  headline: string;
  /** One short line of evidence — never a paragraph. */
  detail: string;
  /** Row accent color. */
  tone: string;
  /** The one number worth scanning, right-aligned big: { value, caption }. */
  stat: { value: string; caption: string } | null;
  /** Ranking weight; the card shows the top few. */
  severity: number;
  /** Tap-through to the move modal, when a move backs the vector. */
  moveSlug?: string;
}

export interface ThreatProfile {
  /** Archetype chips, e.g. ["Revenge killer", "Punisher"] with their tones. */
  archetype: { label: string; tone: string }[];
  vectors: ThreatVector[];
}

/** Sorted (ascending) per-form indexes across the whole meta, for percentiles. */
export interface MetaDistribution {
  offense: number[];
  speed: number[];
  physBulk: number[];
  specBulk: number[];
}

const TONE: Record<ThreatKind, string> = {
  setup: "#f4d23c",
  nuke: "#ff5350",
  "speed-control": "#5cc6ef",
  priority: "#ff9f5c",
  disruption: "#b49cf0",
  field: "#67d693",
  trap: "#ff5350",
  wall: "#67d693",
  speed: "#5cc6ef",
  baseline: "#93a1b0",
};

const KIND_LABEL: Record<ThreatKind, string> = {
  setup: "Set-up sweeper",
  nuke: "Wallbreaker",
  "speed-control": "Speed control",
  priority: "Revenge killer",
  disruption: "Disruption",
  field: "Field control",
  trap: "Punisher",
  wall: "Tank",
  speed: "Fast attacker",
  baseline: "Support",
};

const stripId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Set-up moves and what one use does to the user's stats. `offensive` decides
// the "sweeping" vs "snowballing" framing.
const SETUP_BOOSTS: Record<
  string,
  { mults: Partial<Record<"atk" | "spa" | "spe", number>>; offensive: boolean }
> = {
  swordsdance: { mults: { atk: 2 }, offensive: true },
  dragondance: { mults: { atk: 1.5, spe: 1.5 }, offensive: true },
  nastyplot: { mults: { spa: 2 }, offensive: true },
  tailglow: { mults: { spa: 2.5 }, offensive: true }, // +3 SpA stages = 2.5×, not 4×
  calmmind: { mults: { spa: 1.5 }, offensive: true },
  quiverdance: { mults: { spa: 1.5, spe: 1.5 }, offensive: true },
  shellsmash: { mults: { atk: 2, spa: 2, spe: 2 }, offensive: true },
  bellydrum: { mults: { atk: 4 }, offensive: true },
  geomancy: { mults: { spa: 2, spe: 2 }, offensive: true },
  shiftgear: { mults: { atk: 1.5, spe: 2 }, offensive: true },
  victorydance: { mults: { atk: 1.5, spe: 1.5 }, offensive: true },
  tidyup: { mults: { atk: 1.5, spe: 1.5 }, offensive: true },
  clangoroussoul: { mults: { atk: 1.5, spa: 1.5, spe: 1.5 }, offensive: true },
  noretreat: { mults: { atk: 1.5, spa: 1.5, spe: 1.5 }, offensive: true },
  agility: { mults: { spe: 2 }, offensive: true },
  rockpolish: { mults: { spe: 2 }, offensive: true },
  honeclaws: { mults: { atk: 1.5 }, offensive: true },
  growth: { mults: { atk: 1.5, spa: 1.5 }, offensive: true },
  workup: { mults: { atk: 1.5, spa: 1.5 }, offensive: true },
  bulkup: { mults: { atk: 1.5 }, offensive: false },
  coil: { mults: { atk: 1.5 }, offensive: false },
  curse: { mults: { atk: 1.5 }, offensive: false },
  irondefense: { mults: {}, offensive: false },
  cosmicpower: { mults: {}, offensive: false },
  amnesia: { mults: {}, offensive: false },
  acidarmor: { mults: {}, offensive: false },
  barrier: { mults: {}, offensive: false },
  stockpile: { mults: {}, offensive: false },
  minimize: { mults: {}, offensive: false },
};

// Status / utility moves worth a disruption vector. Short, scannable copy;
// sleep gets extra weight — it removes a Pokémon from the game.
const DISRUPTION: Record<
  string,
  { headline: string; detail: string; weight: number }
> = {
  spore: { headline: "Sleep: Spore", detail: "100% accurate — a Pokémon naps out of the game", weight: 30 },
  "sleep-powder": { headline: "Sleep: Sleep Powder", detail: "75% acc · Grass types and Goggles are immune", weight: 24 },
  hypnosis: { headline: "Sleep: Hypnosis", detail: "60% acc — risky but game-changing", weight: 18 },
  yawn: { headline: "Sleep threat: Yawn", detail: "Forces a switch or a nap", weight: 14 },
  "dark-void": { headline: "Sleep: Dark Void", detail: "Can put BOTH your Pokémon to sleep", weight: 30 },
  "fake-out": { headline: "Flinch turn one: Fake Out", detail: "Budget a lost turn when it comes in", weight: 16 },
  "follow-me": { headline: "Redirects attacks: Follow Me", detail: "Your single-target moves get soaked", weight: 16 },
  "rage-powder": { headline: "Redirects attacks: Rage Powder", detail: "Fails vs Grass types and Safety Goggles", weight: 16 },
  "knock-off": { headline: "Steals your item: Knock Off", detail: "Item gone for the whole game", weight: 10 },
  taunt: { headline: "Blocks status: Taunt", detail: "No set-up, no Protect-adjacent plays", weight: 12 },
  encore: { headline: "Locks your move: Encore", detail: "Repeats your last move for 3 turns", weight: 12 },
  disable: { headline: "Disables a move: Disable", detail: "The move you just used is gone", weight: 10 },
  trick: { headline: "Swaps items: Trick", detail: "A Choice item lands on your Pokémon", weight: 12 },
  switcheroo: { headline: "Swaps items: Switcheroo", detail: "A Choice item lands on your Pokémon", weight: 12 },
  haze: { headline: "Erases boosts: Haze", detail: "Every stat boost on the field resets", weight: 8 },
  "clear-smog": { headline: "Erases boosts: Clear Smog", detail: "The target's stat boosts reset", weight: 8 },
  "will-o-wisp": { headline: "Burns attackers: Will-O-Wisp", detail: "Your physical hits get halved", weight: 12 },
  "wide-guard": { headline: "Blocks spread moves: Wide Guard", detail: "Rock Slide / Earthquake / Heat Wave fizzle this turn", weight: 12 },
  "quick-guard": { headline: "Blocks priority: Quick Guard", detail: "Fake Out and priority attacks fizzle this turn", weight: 10 },
};

const SPEED_DROPS: Record<string, string> = {
  "icy-wind": "Icy Wind",
  electroweb: "Electroweb",
  bulldoze: "Bulldoze",
};

// Moves that (near-)guarantee paralysis — all quarter the target's Speed.
const PARALYSIS: Record<string, string> = {
  "thunder-wave": "Thunder Wave",
  glare: "Glare",
  nuzzle: "Nuzzle",
};

const WEATHER_ABILITIES: Record<string, { headline: string; detail: string }> = {
  drought: { headline: "Sets Sun on entry", detail: "Fire ×1.5 · Water weakened · Chlorophyll doubles Speed" },
  drizzle: { headline: "Sets Rain on entry", detail: "Water ×1.5 · Fire weakened · Swift Swim doubles Speed" },
  sandstream: { headline: "Sets Sand on entry", detail: "Chip damage · Rock types get ×1.5 SpD" },
  snowwarning: { headline: "Sets Snow on entry", detail: "Ice ×1.5 Def · unlocks Aurora Veil" },
};

const SCREENS: Record<string, string> = {
  "aurora-veil": "Aurora Veil",
  reflect: "Reflect",
  "light-screen": "Light Screen",
};

const RECOVERY = new Set([
  "recover", "roost", "morning-sun", "moonlight", "synthesis", "slack-off",
  "soft-boiled", "milk-drink", "shore-up", "strength-sap", "rest",
]);

/** % of `sorted` strictly below `v`. */
function percentile(sorted: number[], v: number): number {
  if (!sorted.length) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return Math.round((lo / sorted.length) * 100);
}

interface FormInput {
  types: PokemonType[];
  stats: PokemonStats;
  abilities: PokemonAbility[];
  comp: CompetitiveProfile;
  moves: MoveSummary[];
}

/** The item multiplier the ladder says to expect on its attacks. */
function itemPowerMult(comp: CompetitiveProfile): { mult: number; label: string | null } {
  const ic = comp.itemClasses ?? {};
  const bandSpecs = (ic.choice ?? 0) - (ic.scarf ?? 0);
  if (bandSpecs >= 30) return { mult: 1.5, label: "Choice item" };
  if ((ic.lifeOrb ?? 0) >= 30) return { mult: 1.3, label: "Life Orb" };
  return { mult: 1, label: null };
}

/** A move's effective punch: power × STAB × the right attack stat × item. */
function effectivePower(
  m: MoveSummary,
  live: Record<string, number>,
  types: readonly PokemonType[],
  item: { mult: number },
): number {
  if (m.damageClass === "status" || !m.power) return 0;
  const stat = m.damageClass === "physical" ? live.attack : live.specialAttack;
  const stab = types.includes(m.type) ? 1.5 : 1;
  return m.power * stat * stab * item.mult;
}

/**
 * The per-form indexes used for meta percentiles. Returns null when the form
 * has no usable ladder read.
 */
export function metaIndexes(form: FormInput): {
  offense: number;
  speed: number;
  physBulk: number;
  specBulk: number;
} | null {
  const { comp } = form;
  const live = lv50Stats(form.stats, comp.spread);
  const item = itemPowerMult(comp);
  let offense = 0;
  for (const m of form.moves) {
    const usage = comp.moveUsage[m.name];
    if (usage == null || usage < 15) continue;
    offense = Math.max(offense, effectivePower(m, live, form.types, item));
  }
  return {
    offense,
    speed: live.speed,
    physBulk: live.hp * live.defense,
    specBulk: live.hp * live.specialDefense,
  };
}

const runStat = (pct: number) => ({ value: `${pct}%`, caption: "run it" });

/** Build the full threat profile for one form. */
export function getThreatProfile(
  form: FormInput,
  meta: MetaDistribution,
): ThreatProfile {
  const { comp, moves, types, stats } = form;
  const usage = comp.moveUsage;
  const au = comp.abilityUsage ?? {};
  const live = lv50Stats(stats, comp.spread);
  const vectors: ThreatVector[] = [];
  const moveBySlug = new Map(moves.map((m) => [m.name, m]));
  const u = (slug: string) => usage[slug] ?? 0;

  // --- Set-up sweep: compute what ONE use actually does to its stats.
  {
    let best: { slug: string; pct: number; boost: (typeof SETUP_BOOSTS)[string] } | null = null;
    for (const [slug, pct] of Object.entries(usage)) {
      const boost = SETUP_BOOSTS[stripId(slug)];
      if (!boost || pct < 10) continue;
      // Ghost-type Curse sacrifices HP to curse the foe — it is NOT a stat
      // boost, so it must not read as a set-up sweep (Typhlosion-Hisui, etc.).
      if (stripId(slug) === "curse" && types.includes("ghost")) continue;
      if (!best || pct > best.pct) best = { slug, pct, boost };
    }
    if (best) {
      const move = moveBySlug.get(best.slug);
      const name = move?.displayName ?? best.slug;
      const parts: string[] = [];
      const { atk, spa, spe } = best.boost.mults;
      if (atk) parts.push(`Atk ${live.attack}→${Math.floor(live.attack * atk)}`);
      if (spa) parts.push(`SpA ${live.specialAttack}→${Math.floor(live.specialAttack * spa)}`);
      if (spe) parts.push(`Spe ${live.speed}→${Math.floor(live.speed * spe)}`);
      vectors.push({
        kind: "setup",
        headline: best.boost.offensive
          ? `One ${name} from sweeping`
          : `Snowballs behind ${name}`,
        detail: parts.length ? `After one: ${parts.join(" · ")}` : "Boosts every turn it sits",
        tone: TONE.setup,
        stat: runStat(best.pct),
        severity: 40 + best.pct / 2 + (best.boost.offensive ? 10 : 0),
        moveSlug: best.slug,
      });
    }
  }

  // --- Raw damage, as a meta percentile.
  {
    const item = itemPowerMult(comp);
    let best: { m: MoveSummary; pct: number; power: number } | null = null;
    for (const m of moves) {
      const pct = usage[m.name];
      if (pct == null || pct < 15) continue;
      const power = effectivePower(m, live, types, item);
      if (power > 0 && (!best || power > best.power)) best = { m, pct, power };
    }
    if (best) {
      const p = percentile(meta.offense, best.power);
      if (p >= 80) {
        const statLabel = best.m.damageClass === "physical" ? "Atk" : "SpA";
        const statVal = best.m.damageClass === "physical" ? live.attack : live.specialAttack;
        vectors.push({
          kind: "nuke",
          headline: `Huge damage: ${best.m.displayName}`,
          detail: `Off ${statVal} ${statLabel}${item.label ? ` + ${item.label}` : ""} — hits harder than most of the meta`,
          tone: TONE.nuke,
          stat: { value: `${p}%`, caption: "of meta" },
          severity: p - 18,
          moveSlug: best.m.name,
        });
      }
    }
  }

  // --- Speed control.
  if (u("trick-room") >= 15) {
    const si = comp.speedInvest;
    const slow = si ? si.minus + si.none : null;
    vectors.push({
      kind: "speed-control",
      headline: "Sets Trick Room",
      detail: `Slowest moves first, 5 turns${slow != null ? ` · ${slow}% of sets run no Speed on purpose` : ""}`,
      tone: TONE["speed-control"],
      stat: runStat(u("trick-room")),
      severity: 45 + u("trick-room") / 2,
      moveSlug: "trick-room",
    });
  }
  if (u("tailwind") >= 15) {
    vectors.push({
      kind: "speed-control",
      headline: "Sets Tailwind",
      detail: "Its whole team at double Speed, 4 turns",
      tone: TONE["speed-control"],
      stat: runStat(u("tailwind")),
      severity: 38 + u("tailwind") / 2,
      moveSlug: "tailwind",
    });
  }
  for (const [slug, label] of Object.entries(SPEED_DROPS)) {
    if (u(slug) >= 20) {
      vectors.push({
        kind: "speed-control",
        headline: `Drops your Speed: ${label}`,
        detail: "Your speed checks flip next turn",
        tone: TONE["speed-control"],
        stat: runStat(u(slug)),
        severity: 28 + u(slug) / 3,
        moveSlug: slug,
      });
      break; // one speed-drop read is enough
    }
  }
  for (const [slug, label] of Object.entries(PARALYSIS)) {
    if (u(slug) >= 20) {
      vectors.push({
        kind: "speed-control",
        headline: `Paralysis: ${label}`,
        detail: "¼ Speed · 25% fully skipped turns",
        tone: TONE["speed-control"],
        stat: runStat(u(slug)),
        severity: 26 + u(slug) / 3,
        moveSlug: slug,
      });
      break; // one paralysis read is enough
    }
  }

  // --- Priority revenge-killing. (Fake Out is a disruption read, not this.)
  {
    let best: MoveSummary | null = null;
    for (const m of moves) {
      if (m.priority <= 0 || m.damageClass === "status" || m.name === "fake-out") continue;
      const pct = usage[m.name];
      if (pct == null || pct < 20) continue;
      if (!best || pct > (usage[best.name] ?? 0)) best = m;
    }
    if (best) {
      const detail =
        best.name === "sucker-punch"
          ? "Fails if you don't attack — status or Protect beats it"
          : best.name === "extreme-speed"
            ? "+2 priority — beats even other priority"
            : "Ignores Speed — picks off weakened Pokémon";
      vectors.push({
        kind: "priority",
        headline: `Strikes first: ${best.displayName}`,
        detail,
        tone: TONE.priority,
        stat: runStat(usage[best.name] ?? 0),
        severity: 30 + (usage[best.name] ?? 0) / 3,
        moveSlug: best.name,
      });
    }
  }

  // --- Disruption: moves (sleep weighted heaviest) + Intimidate.
  {
    const hits = Object.entries(DISRUPTION)
      .map(([slug, d]) => ({ slug, d, pct: u(slug) }))
      .filter((x) => x.pct >= 15)
      .sort((a, b) => b.pct + b.d.weight - (a.pct + a.d.weight))
      .slice(0, 2);
    for (const { slug, d, pct } of hits) {
      vectors.push({
        kind: "disruption",
        headline: d.headline,
        detail: d.detail,
        tone: TONE.disruption,
        stat: runStat(pct),
        severity: 20 + pct / 4 + d.weight,
        moveSlug: slug,
      });
    }
    if ((au.intimidate ?? 0) >= 30) {
      vectors.push({
        kind: "disruption",
        headline: "Intimidate on entry",
        detail: "Both your Pokémon hit softer physically",
        tone: TONE.disruption,
        stat: { value: `${au.intimidate}%`, caption: "have it" },
        severity: 26 + (au.intimidate ?? 0) / 4,
      });
    }
  }

  // --- Field control: weather + screens.
  for (const [id, w] of Object.entries(WEATHER_ABILITIES)) {
    if ((au[id] ?? 0) >= 30) {
      vectors.push({
        kind: "field",
        headline: w.headline,
        detail: w.detail,
        tone: TONE.field,
        stat: { value: `${au[id]}%`, caption: "have it" },
        severity: 30 + (au[id] ?? 0) / 4,
      });
      break;
    }
  }
  {
    let best: { slug: string; label: string } | null = null;
    for (const [slug, label] of Object.entries(SCREENS)) {
      if (u(slug) >= 20 && (!best || u(slug) > u(best.slug))) best = { slug, label };
    }
    if (best) {
      vectors.push({
        kind: "field",
        headline: `Sets screens: ${best.label}`,
        detail:
          best.slug === "aurora-veil"
            ? "Both screens at once (needs snow) — damage halved"
            : "Incoming damage halved for its team, 5 turns",
        tone: TONE.field,
        stat: runStat(u(best.slug)),
        severity: 24 + u(best.slug) / 3,
        moveSlug: best.slug,
      });
    }
  }

  // --- Ability traps (Defiant, Levitate, absorbs…). One row is usually the
  // story; a second only earns its slot when it's actually run (≥25%).
  const traps = getTrapWarnings(form.abilities, comp);
  for (const trap of traps.filter(
    (t, i) => i === 0 || (t.pct ?? 0) >= 25,
  ).slice(0, 2)) {
    vectors.push({
      kind: "trap",
      headline: trap.label,
      detail: trap.warning,
      tone: trap.tone === "red" ? "#ff5350" : "#f59e0b",
      stat: trap.pct != null ? { value: `${trap.pct}%`, caption: "have it" } : null,
      severity: (trap.tone === "red" ? 36 : 22) + (trap.pct ?? 10) / 4,
    });
  }

  // --- Tank: meta-percentile bulk plus staying power.
  {
    const pPhys = percentile(meta.physBulk, live.hp * live.defense);
    const pSpec = percentile(meta.specBulk, live.hp * live.specialDefense);
    const p = Math.max(pPhys, pSpec);
    const healSlug = [...RECOVERY].find((s) => u(s) >= 20);
    const av = (comp.itemClasses?.av ?? 0) >= 30;
    if (p >= 90 || (p >= 80 && (healSlug || av))) {
      const side =
        pPhys >= 90 && pSpec >= 90 ? "both ways" : pPhys >= pSpec ? "physically" : "specially";
      const extras: string[] = [];
      if (healSlug) extras.push(`heals: ${moveBySlug.get(healSlug)?.displayName ?? healSlug} ${u(healSlug)}%`);
      if (av) extras.push("usually Assault Vest");
      vectors.push({
        kind: "wall",
        headline: "Hard to remove",
        detail: `Top-tier bulk ${side}${extras.length ? ` · ${extras.join(" · ")}` : ""}`,
        tone: TONE.wall,
        stat: { value: `${p}%`, caption: "of meta" },
        severity: 14 + p / 4 + (healSlug ? 8 : 0),
        moveSlug: healSlug,
      });
    }
  }

  // --- Raw speed tier (with the Scarf read).
  {
    const p = percentile(meta.speed, live.speed);
    const scarf = comp.itemClasses?.scarf ?? 0;
    if (p >= 85 || (p >= 60 && scarf >= 25)) {
      const scarfed = Math.floor(live.speed * 1.5);
      const isScarf = scarf >= 25;
      vectors.push({
        kind: "speed",
        headline: isScarf ? "Likely Choice Scarf" : "Outspeeds the meta",
        detail: isScarf
          ? `${live.speed} Spe → ${scarfed} scarfed (top ${100 - percentile(meta.speed, scarfed)}%)`
          : `${live.speed} Spe at Lv. 50 on its common set`,
        tone: TONE.speed,
        stat: isScarf
          ? { value: `${scarf}%`, caption: "run it" }
          : { value: `${p}%`, caption: "of meta" },
        severity: 12 + p / 5 + (isScarf ? 16 : 0),
      });
    }
  }

  // Never leave the headline card blank when there IS ladder data: a form that
  // crosses no threshold is a support/filler mon, but the trainer still needs
  // its most-used move (and the kill-shot strip below it). Surface a baseline.
  if (vectors.length === 0 && Object.keys(usage).length) {
    const [topSlug, topPct] = Object.entries(usage).sort((a, b) => b[1] - a[1])[0];
    const m = moveBySlug.get(topSlug);
    vectors.push({
      kind: "baseline",
      headline: m ? `Most-used move: ${m.displayName}` : "No standout threat",
      detail: "No dominant threat vector — plays a support / balanced role",
      tone: TONE.baseline,
      stat: m ? runStat(Math.round(topPct)) : null,
      severity: 1,
      moveSlug: m?.name,
    });
  }

  vectors.sort((a, b) => b.severity - a.severity);
  const top = vectors.slice(0, 4);

  const archetype: { label: string; tone: string }[] = [];
  for (const v of top) {
    if (!archetype.some((a) => a.label === KIND_LABEL[v.kind])) {
      archetype.push({ label: KIND_LABEL[v.kind], tone: v.tone });
    }
    if (archetype.length === 2) break;
  }

  return { archetype, vectors: top };
}
