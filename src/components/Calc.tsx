"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { HomeIcon } from "./HomeIcon";
import { TypeBadge } from "./TypeBadge";
import {
  computeDamage, effectiveSpeeds, moveToCalcMove, turnOrder,
  type CalcField, type CalcPokemon, type DamageResult, type Terrain, type Weather,
} from "@/lib/damage";
import { NATURES, formPillLabel, natureEffect } from "@/lib/format";
import {
  SP_BUDGET, SP_CAP, SP_STATS, statPointsToSpread, totalStatPoints, type StatPointMap,
} from "@/lib/stat-points";
import { isSpreadMove } from "@/lib/spread";
import { TYPE_COLORS } from "@/lib/type-meta";
import { useCalcSets, type SavedSet } from "@/lib/calc-sets";
import type { CalcEntry, CalcForm, CalcIndex, CalcMoveLite } from "@/lib/calc-data";
import type { EvStat } from "@/lib/types";

// Items that change the damage math (others are cosmetic on this screen).
/**
 * Champions' real held-item pool, NOT the mainline VGC one.
 *
 * This list used to offer Choice Band, Choice Specs, Assault Vest, Eviolite,
 * Safety Goggles, Covert Cloak and Booster Energy — none of which exist in
 * Champions. Pokémon Showdown's champions mod tags all seven nonstandard, and
 * across a full ladder month (132 distinct items) not one Pokémon is recorded
 * holding any of them, while Choice SCARF shows up on 133. They were mainline
 * assumptions, and they let a trainer build a calc on an item they can never
 * actually bring. `npm run status` now holds every entry below to Showdown's
 * Champions item pool (baked as `pokemon.json` → `itemPool`).
 * (`damage.ts` still MODELS those items — it's a faithful port of the gen9
 * formula and the format simply never presents them. Don't "clean that up":
 * the parity test exercises those branches against @smogon/calc.)
 *
 * Ordered by what a mid-battle trainer reaches for: damage-affecting first,
 * then bulk/utility, then the rest of the v1.2.0 additions. EVERY pool item
 * that changes a damage roll is here (damage.test.ts holds the list to the
 * pool and to the engine, one parity pin per item): the general boosters, the
 * 18 type boosters (1.2× on their type — Sylveon's Fairy Feather, Rillaboom's
 * Miracle Seed), the 18 resist berries (halve one super-effective hit —
 * Kingambit's Chople, Sinistcha's Colbur), Light Ball (Pikachu only) and Iron
 * Ball (grounds the holder, halves its Speed). Metronome stays out: its boost
 * needs consecutive uses, which the calc has no input for. The four terrain
 * Seeds boost a stat only while their terrain is up — pick the Terrain and the
 * engine fires (and spends) the Seed, exactly as @smogon/calc does.
 */
const ITEMS = [
  "None",
  // Change the damage number.
  "Life Orb", "Choice Scarf", "Expert Belt", "Normal Gem", "Muscle Band", "Wise Glasses",
  // Type boosters: 1.2× on one type's moves.
  "Black Belt", "Black Glasses", "Charcoal", "Dragon Fang", "Fairy Feather", "Hard Stone",
  "Magnet", "Metal Coat", "Miracle Seed", "Mystic Water", "Never-Melt Ice", "Poison Barb",
  "Sharp Beak", "Silk Scarf", "Silver Powder", "Soft Sand", "Spell Tag", "Twisted Spoon",
  // Resist berries: halve one super-effective hit of their type (Chilan: any Normal hit).
  "Babiri Berry", "Charti Berry", "Chilan Berry", "Chople Berry", "Coba Berry", "Colbur Berry",
  "Haban Berry", "Kasib Berry", "Kebia Berry", "Occa Berry", "Passho Berry", "Payapa Berry",
  "Rindo Berry", "Roseli Berry", "Shuca Berry", "Tanga Berry", "Wacan Berry", "Yache Berry",
  // One-species / field-changing.
  "Light Ball", "Iron Ball",
  // Bulk / survival.
  "Focus Sash", "Sitrus Berry", "Leftovers", "Rocky Helmet", "Air Balloon",
  // Utility with real ladder usage.
  "Mental Herb", "White Herb", "Wide Lens", "Scope Lens", "Light Clay",
  // Remaining v1.2.0 additions.
  "Terrain Extender", "Electric Seed", "Grassy Seed", "Psychic Seed", "Misty Seed",
  "Leek", "Red Card", "Binding Band", "Eject Button",
] as const;

/**
 * The list's own spelling of a held item. Smogon's ladder data writes some
 * names differently ("Never Melt Ice"), and a preset carrying that spelling
 * would sit beside "Never-Melt Ice" as a second, duplicate-looking option.
 */
const itemId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function canonicalItem(item: string | null | undefined): string {
  if (!item) return "None";
  return ITEMS.find((it) => itemId(it) === itemId(item)) ?? item;
}

const WEATHERS: { label: string; value: Weather }[] = [
  { label: "—", value: null }, { label: "☀ Sun", value: "Sun" }, { label: "🌧 Rain", value: "Rain" },
  { label: "🏜 Sand", value: "Sand" }, { label: "❄ Snow", value: "Snow" },
];

// Reg M-C runs on terrain — Rillaboom's Grassy Surge (#1, ~47% of teams) and
// Indeedee's Psychic Surge (~26%) — and it decides whole moves, not just
// numbers: Steel Roller fails without one and Psychic Terrain stops Fake Out
// cold. So it is field state, next to weather.
const TERRAINS: { label: string; value: Terrain }[] = [
  { label: "—", value: null }, { label: "Electric", value: "Electric" }, { label: "Grassy", value: "Grassy" },
  { label: "Psychic", value: "Psychic" }, { label: "Misty", value: "Misty" },
];

const SP_LABEL: Record<EvStat, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };

interface MonState {
  slug: string;
  formIdx: number;
  nature: string;
  sp: StatPointMap;
  ability: string | null;
  item: string;
  moveSlug: string;
  offBoost: number; // −6…+6, applied to Atk & SpA when it attacks
  defBoost: number; // −6…+6, applied to Def & SpD when it's hit
  speBoost: number; // −6…+6 Speed stages (turn order, Gyro Ball, Electro Ball)
  burn: boolean;
  para: boolean; // paralysis (exclusive with burn): ½ Speed, Facade 2×
  tailwind: boolean; // Tailwind on THIS mon's side: ×2 Speed
  /** Pokémon on this mon's side (2, or 1 when its partner is gone) — the spread ×0.75 and Dragon Darts read the TARGET side's. */
  sideCount: 1 | 2;
  screens: boolean; // behind screens (halves incoming, both categories)
  helpingHand: boolean;
  friendGuard: boolean;
  hpPct: number;
}

const formOf = (entry: CalcEntry, i: number): CalcForm => entry.forms[i] ?? entry.forms[0];

function defaultMon(entry: CalcEntry, formIdx = 0): MonState {
  const form = formOf(entry, formIdx);
  const preset = form.preset;
  return {
    slug: entry.slug,
    formIdx,
    nature: preset?.nature ?? "Hardy",
    sp: preset ? { ...preset.sp } : {},
    ability: preset?.ability ?? form.abilities[0]?.displayName ?? null,
    // No preset item → the item the form needs to exist (a Mega's stone):
    // Mega Absol has no Master+ set and opened holding nothing.
    item: canonicalItem(preset?.item ?? form.requiredItem),
    moveSlug: preset?.topMoves[0] ?? entry.moveSlugs[0] ?? "",
    offBoost: 0,
    defBoost: 0,
    speBoost: 0,
    burn: false,
    para: false,
    tailwind: false,
    sideCount: 2,
    screens: false,
    helpingHand: false,
    friendGuard: false,
    hpPct: 100,
  };
}

function toCalcPokemon(state: MonState, entry: CalcEntry): CalcPokemon {
  const form = formOf(entry, state.formIdx);
  const spread = statPointsToSpread(state.nature, state.sp);
  return {
    // The form's OWN battle identity — never the ladder name its preset is
    // borrowed from (Kantonian Tauros fought as Tauros-Paldea-Aqua).
    name: form.battleName,
    types: form.types,
    baseStats: form.stats,
    ability: state.ability,
    item: state.item !== "None" ? state.item : null,
    nature: state.nature,
    evs: spread.evs,
    boosts: { atk: state.offBoost, spa: state.offBoost, def: state.defBoost, spd: state.defBoost, spe: state.speBoost },
    status: state.burn ? "brn" : state.para ? "par" : null,
    curHpPct: state.hpPct,
    weightKg: form.weightKg,
    // Stance Change: Aegislash swings in Blade Forme whichever forme is selected.
    attackForm: form.attacksAs ?? undefined,
  };
}

/**
 * One direction's field: shared weather/terrain, plus each SIDE's own state —
 * the attacker side's Helping Hand / Tailwind / occupancy and the defender
 * side's screens / Friend Guard / Tailwind / occupancy. Spread ×0.75 and Dragon
 * Darts read the TARGET side's occupancy, so the two directions differ when
 * one side is down to a single mon.
 */
function fieldFor(atk: MonState, def: MonState, weather: Weather, terrain: Terrain, trickRoom: boolean): CalcField {
  return {
    gameType: "Doubles", weather, terrain, trickRoom,
    attackerSide: atk.sideCount, defenderSide: def.sideCount,
    attackerTailwind: atk.tailwind, defenderTailwind: def.tailwind,
    helpingHand: atk.helpingHand, auroraVeil: def.screens, friendGuard: def.friendGuard,
  };
}

/** Snapshot a mon's set (not its transient battle state) for saving. */
function setFromMon(state: MonState, entry: CalcEntry): Omit<SavedSet, "id"> {
  const form = formOf(entry, state.formIdx);
  return {
    name: `${form.label}${state.item !== "None" ? ` @ ${state.item}` : ""}`,
    slug: state.slug,
    formIdx: state.formIdx,
    nature: state.nature,
    sp: state.sp,
    ability: state.ability,
    item: state.item,
    moveSlug: state.moveSlug,
  };
}

/** Rebuild a full mon state from a saved set (battle state reset to defaults). */
function monStateFromSet(set: SavedSet, bySlug: Map<string, CalcEntry>): MonState | null {
  const entry = bySlug.get(set.slug);
  if (!entry) return null;
  const formIdx = Math.min(set.formIdx, entry.forms.length - 1);
  return {
    ...defaultMon(entry, formIdx),
    nature: set.nature,
    sp: { ...set.sp },
    ability: set.ability,
    item: canonicalItem(set.item),
    moveSlug: set.moveSlug,
  };
}

/** Index of the form with this key (?af= / ?df=, by KEY — never by index), else the base. */
function formIdxOf(entry: CalcEntry, key: string | null): number {
  if (!key) return 0;
  const i = entry.forms.findIndex((f) => (f.key ?? entry.slug) === key);
  return i >= 0 ? i : 0;
}

export function Calc({ index }: { index: CalcIndex }) {
  const bySlug = useMemo(() => {
    const m = new Map<string, CalcEntry>();
    for (const e of index.entries) m.set(e.slug, e);
    return m;
  }, [index]);

  // First paint answers a question trainers actually have: the format's two
  // most-picked mons squaring off — not an alphabetical accident (Abomasnow
  // vs Absol). The ?a=/?d= deep-link effect below still overrides.
  const first =
    (index.defaultSlugs && bySlug.get(index.defaultSlugs[0])) ?? index.entries[0];
  const second =
    (index.defaultSlugs && bySlug.get(index.defaultSlugs[1])) ??
    index.entries[1] ??
    first;
  const [attacker, setAttacker] = useState<MonState>(() => defaultMon(first));
  const [defender, setDefender] = useState<MonState>(() => defaultMon(second));
  const [weather, setWeather] = useState<Weather>(null);
  const [terrain, setTerrain] = useState<Terrain>(null);
  const [trickRoom, setTrickRoom] = useState(false);
  const { sets, saveSet, removeSet } = useCalcSets();

  const loadInto = (side: "attacker" | "defender", set: SavedSet) => {
    const state = monStateFromSet(set, bySlug);
    if (!state) return;
    (side === "attacker" ? setAttacker : setDefender)(state);
  };

  // Seed context from the URL (?a=slug&af=formKey&d=slug&df=formKey) so other
  // screens can deep-link a matchup into the calc — the FORM by key: a pinned
  // Mega Charizard Y opened as base Charizard when only the slug was passed.
  // Deliberately in an effect, not a lazy initializer: the page is statically
  // prerendered with defaults, so reading the query during render would cause
  // a hydration mismatch. Runs once on mount.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const a = q.get("a");
    const d = q.get("d");
    /* eslint-disable react-hooks/set-state-in-effect */
    if (a && bySlug.has(a)) setAttacker(defaultMon(bySlug.get(a)!, formIdxOf(bySlug.get(a)!, q.get("af"))));
    if (d && bySlug.has(d)) setDefender(defaultMon(bySlug.get(d)!, formIdxOf(bySlug.get(d)!, q.get("df"))));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [bySlug]);

  const aEntry = bySlug.get(attacker.slug) ?? first;
  const dEntry = bySlug.get(defender.slug) ?? second;

  const aMon = toCalcPokemon(attacker, aEntry);
  const dMon = toCalcPokemon(defender, dEntry);
  const aMove = index.moves[attacker.moveSlug];
  const dMove = index.moves[defender.moveSlug];

  // Only surface the side-occupancy control when a move that READS it is
  // selected — spread moves, Expanding Force in Psychic Terrain, Dragon Darts.
  const readsTargets = (m: CalcMoveLite | undefined) =>
    isSpreadMove(m?.target) || m?.slug === "dragon-darts" || (terrain === "Psychic" && m?.slug === "expanding-force");
  const spreadInPlay = readsTargets(aMove) || readsTargets(dMove);

  const fwdField = fieldFor(attacker, defender, weather, terrain, trickRoom);
  const backField = fieldFor(defender, attacker, weather, terrain, trickRoom);

  const forward = calcOf(aMon, dMon, aMove, fwdField);
  const back = calcOf(dMon, aMon, dMove, backField);

  // Turn order from EFFECTIVE Speed (stages, Scarf, Tailwind, paralysis,
  // weather abilities…) and the selected moves' effective priority — the raw
  // Lv50 stat said Dragapult outsped a Choice Scarf Garchomp.
  const speeds = effectiveSpeeds(aMon, dMon, fwdField);
  const aPriority = forward?.move.priority ?? aMove?.priority ?? 0;
  const dPriority = back?.move.priority ?? dMove?.priority ?? 0;
  const order = turnOrder({ speed: speeds.a, priority: aPriority }, { speed: speeds.b, priority: dPriority }, trickRoom);

  const swap = () => {
    setAttacker(defender);
    setDefender(attacker);
  };

  return (
    <main className="flex min-h-dvh flex-col pb-16">
      {/* Header + verdict stick together, so the answer stays on-screen while
          you reach the controls below. */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <header className="flex items-center gap-3 px-4 py-3">
          <Link
            href="/"
            aria-label="Home"
            className="tap-target grid size-9 shrink-0 place-items-center rounded-xl glass-quiet text-muted active:bg-surface-2"
          >
            <HomeIcon className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            {/* Route title, not a hud-label — those mark sections, and this
                header was speaking in the same voice as its own ATTACKER /
                FIELD labels below. */}
            <h1 className="font-display text-[15px] font-bold uppercase leading-tight tracking-wider">
              Battle Calc
            </h1>
            <p className="truncate text-[11px] text-muted">
              Doubles · Lv 50 · {index.bracketShort} sets
            </p>
          </div>
          <button
            onClick={swap}
            className="tap-target rounded-lg glass-quiet px-2.5 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wider text-muted active:bg-surface-2"
          >
            ⇅ Swap
          </button>
        </header>

        <div className="border-t border-border/60 px-4 py-3">
          <VerdictRow tone="hit" from={aEntry.name} to={dEntry.name} move={aMove} result={forward} />
          <div className="my-2.5 h-px bg-border/70" />
          <VerdictRow tone="take" from={dEntry.name} to={aEntry.name} move={dMove} result={back} />
          <p className="mt-2.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted">
            <span aria-hidden>⚡</span>
            {order === "tie"
              ? `Speed tie · ${speeds.a}`
              : order === "a"
                ? `${aEntry.name} moves first · ${speeds.a} vs ${speeds.b}`
                : `${dEntry.name} moves first · ${speeds.b} vs ${speeds.a}`}
            <span className="text-muted/60">
              {aPriority !== dPriority
                ? `(priority ${fmtPriority(order === "b" ? dPriority : aPriority)})`
                : trickRoom ? "(Trick Room · effective Speed)" : "(effective Speed)"}
            </span>
          </p>
        </div>
      </div>

      {/* The duel: attacker set on the left, defender set on the right. */}
      <section className="mt-3 grid grid-cols-2 items-start gap-2 px-2.5">
        <MonCard
          role="attacker"
          state={attacker}
          setState={setAttacker}
          entries={index.entries}
          bySlug={bySlug}
          moves={index.moves}
          onSave={() => saveSet(setFromMon(attacker, aEntry))}
        />
        <MonCard
          role="defender"
          state={defender}
          setState={setDefender}
          entries={index.entries}
          bySlug={bySlug}
          moves={index.moves}
          onSave={() => saveSet(setFromMon(defender, dEntry))}
        />
      </section>

      {/* Shared field + per-side battle state, in one aligned console. */}
      <div className="mt-2.5 px-2.5">
        <FieldControls
          attacker={attacker}
          setAttacker={setAttacker}
          defender={defender}
          setDefender={setDefender}
          weather={weather}
          setWeather={setWeather}
          terrain={terrain}
          setTerrain={setTerrain}
          spreadInPlay={spreadInPlay}
          trickRoom={trickRoom}
          setTrickRoom={setTrickRoom}
          aName={aEntry.name}
          dName={dEntry.name}
        />
      </div>

      {sets.length > 0 && (
        <section className="mt-5 px-4">
          <h2 className="hud-label mb-2 text-[11px]">Saved sets</h2>
          <div className="space-y-1.5">
            {sets
              .slice()
              .reverse()
              .map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg glass-quiet px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{s.name}</span>
                  {/* "Attacker"/"Defender" — the hud-labels' own words, not
                      "Atk"/"Def", which are stat names 100px above. */}
                  <button
                    onClick={() => loadInto("attacker", s)}
                    className="tap-target rounded-md bg-surface-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted ring-1 ring-inset ring-white/5 active:bg-surface"
                  >
                    → Attacker
                  </button>
                  <button
                    onClick={() => loadInto("defender", s)}
                    className="tap-target rounded-md bg-surface-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted ring-1 ring-inset ring-white/5 active:bg-surface"
                  >
                    → Defender
                  </button>
                  <button
                    onClick={() => removeSet(s.id)}
                    aria-label={`Delete ${s.name}`}
                    className="tap-target grid size-7 place-items-center rounded-md text-muted active:text-accent"
                  >
                    ✕
                  </button>
                </div>
              ))}
          </div>
        </section>
      )}

      <footer className="mt-6 px-4 text-[11px] leading-relaxed text-muted/80">
        Stat Points map to the standard Lv50 stat formula (31 IVs) — the calc&apos;s numbers match
        the app&apos;s baked KO benchmarks, verified against the Smogon damage engine. Weight/speed
        moves (Grass Knot, Heavy Slam, Gyro Ball…) are calculated; a few situational ones (Counter,
        Fissure, Fling…) show “not calculated”. No Terastallization; no live data calls.
      </footer>
    </main>
  );
}

/** Compute a direction's damage, or null if the move can't be modeled. */
function calcOf(
  attacker: CalcPokemon,
  defender: CalcPokemon,
  move: CalcMoveLite | undefined,
  field: CalcField,
): DamageResult | null {
  if (!move) return null;
  const calcMove = moveToCalcMove(move);
  if (!calcMove) return null;
  // The boost controls are mirrored (Atk & SpA move together, as do Def & SpD),
  // so a stage-COUNTING move would count each control twice: Corviknight's Bulk
  // Up +1 (offense +1, defense +1) read Power Trip at 100 BP, not 60. Keep one
  // stat per control — the attacking stat the move uses, and Def.
  let user = attacker;
  if (move.slug === "stored-power" || move.slug === "power-trip") {
    const b = attacker.boosts ?? {};
    const hit = calcMove.category === "special" ? "spa" : "atk";
    user = { ...attacker, boosts: { [hit]: b[hit], def: b.def, spe: b.spe } };
  }
  return computeDamage(user, defender, calcMove, field);
}

// --- verdict --------------------------------------------------------------------

const fmtPriority = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const TYPE_LABEL = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * The move as the ENGINE resolved it (DamageResult.move): Weather Ball in Sun
 * reads "Fire · 100 BP", the ×0.75 shows only when it really applied (not for
 * an airborne Expanding Force), Dragon Darts says how many darts land.
 */
function moveFactsLine(r: DamageResult, slug: string | undefined): string {
  const m = r.move;
  const parts = [TYPE_LABEL(m.type), m.basePower != null ? `${m.basePower} BP` : "fixed damage"];
  // Dragon Darts: one dart per foe — say which case the Targets control chose.
  if (slug === "dragon-darts") parts.push(m.hits === 1 ? "1 dart (2 foes)" : "2 darts (1 foe)");
  else if (m.hits > 1) parts.push(`${m.hits} hits`);
  if (m.spread) parts.push(`spread ×0.75 (${m.targets} targets)`);
  if (m.priority !== 0) parts.push(`priority ${fmtPriority(m.priority)}`);
  return parts.join(" · ");
}

/** Defender HP left after one use — from the engine's survival-aware walk, never hp − damage. */
function hpLeftText(r: DamageResult): string {
  const { min, max } = r.hpAfter;
  const pct = (n: number) => Math.round((n / r.maxHp) * 100);
  if (max === 0) return "0 HP";
  return min === max ? `${min} HP (${pct(min)}%)` : `${min}–${max} HP (${pct(min)}–${pct(max)}%)`;
}

function VerdictRow({
  tone,
  from,
  to,
  move,
  result,
}: {
  tone: "hit" | "take";
  from: string;
  to: string;
  move: CalcMoveLite | undefined;
  result: DamageResult | null;
}) {
  // No damage at all: an immunity ("No effect") or a move that fails outright.
  const blank = !!result && (result.immune || !!result.fails);
  const label = result && !blank ? result.verdict.label : null;
  const kills = label != null && (label === "OHKO" || label.startsWith("OHKO"));
  const twoHit = label != null && label.startsWith("2HKO");
  // The green Kill-shot pill = "you KO it"; accent = "it KOs you"; amber = a
  // roll-dependent 2HKO — the app's existing color grammar, reused verbatim.
  const pill =
    !result || blank
      ? "border-border bg-surface-2 text-muted"
      : kills
        ? tone === "hit"
          ? "border-green-500/40 bg-green-500/10 text-green-300"
          : "border-accent/40 bg-accent/10 text-accent"
        : twoHit
          ? "border-amber-300/40 bg-amber-300/10 text-amber-300"
          : "border-border bg-surface-2 text-foreground/80";
  const partialOhko =
    result && !blank && !result.verdict.guaranteed &&
    result.verdict.ohkoChance > 0 && result.verdict.ohkoChance < 100;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider">
          <span className="truncate font-semibold text-foreground/80">{from}</span>
          <span className="text-muted/50">▸</span>
          <span className="truncate text-muted">{to}</span>
        </div>
        <div className="truncate text-[13px] font-medium">{move ? move.displayName : "—"}</div>
        {result && <div className="truncate text-[10px] text-muted">{moveFactsLine(result, move?.slug)}</div>}
        {result && !blank && (
          <div className="truncate text-[10px] text-muted">
            {result.survival ? `${result.survival.label} · ` : ""}
            leaves {hpLeftText(result)}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {!result ? (
          <span className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            not calculated
          </span>
        ) : blank ? (
          <>
            <span className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
              {result.fails ? "Fails" : "No effect"}
            </span>
            {result.fails && <span className="text-[10px] text-muted">{result.fails}</span>}
          </>
        ) : (
          <>
            <div className="font-mono text-xl font-bold leading-none tabular-nums">
              {Math.round(result.minPct)}–{Math.round(result.maxPct)}
              <span className="text-[11px] font-normal text-muted">%</span>
            </div>
            <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${pill}`}>
              {label}
              {partialOhko ? ` · ${Math.round(result.verdict.ohkoChance)}% OHKO` : ""}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// --- one combatant's editor -----------------------------------------------------

function MonCard({
  role,
  state,
  setState,
  entries,
  bySlug,
  moves,
  onSave,
}: {
  role: "attacker" | "defender";
  state: MonState;
  setState: (s: MonState) => void;
  entries: CalcEntry[];
  bySlug: Map<string, CalcEntry>;
  moves: Record<string, CalcMoveLite>;
  onSave: () => void;
}) {
  const entry = bySlug.get(state.slug) ?? entries[0];
  const form = formOf(entry, state.formIdx);
  const accent = TYPE_COLORS[form.types[0]] ?? "#5b6675";
  const spent = totalStatPoints(state.sp);
  const nat = natureEffect(state.nature);

  const pickMon = (slug: string) => setState(defaultMon(bySlug.get(slug) ?? entries[0]));
  const pickForm = (i: number) => setState(defaultMon(entry, i));
  const patch = (p: Partial<MonState>) => setState({ ...state, ...p });

  // A Mega's baked set holds its Mega Stone, which isn't in the generic ITEMS
  // list — and a <select> whose value matches no <option> renders as the FIRST
  // one. So Mega Metagross silently read "None" while really holding
  // Metagrossite: the field lied, and one tap on it threw the stone away.
  // Any held item the list doesn't already carry gets appended.
  // The form's required item (a Mega's own stone) is ALWAYS offered — Mega
  // Absol, with no preset, had no way to pick Absolite.
  const itemOptions = useMemo(() => {
    const extra = [state.item, canonicalItem(form.preset?.item), form.requiredItem ? canonicalItem(form.requiredItem) : null].filter(
      (it): it is string => !!it && !(ITEMS as readonly string[]).includes(it),
    );
    return extra.length ? [...ITEMS, ...new Set(extra)] : (ITEMS as readonly string[]);
  }, [state.item, form.preset?.item, form.requiredItem]);

  // Saving appends to a section that may be off-screen (or not exist yet) —
  // without an on-the-spot confirmation, three hopeful taps mint three
  // duplicate sets. The glyph flips to ✓ "saved" for a beat instead.
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current != null) window.clearTimeout(savedTimer.current);
    },
    [],
  );
  const handleSave = () => {
    onSave();
    setJustSaved(true);
    if (savedTimer.current != null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setJustSaved(false), 1200);
  };

  const moveOptions = entry.moveSlugs
    .map((s) => moves[s])
    .filter((m): m is CalcMoveLite => !!m);

  return (
    <div className="rounded-xl glass p-2.5" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="mb-1.5 flex items-center gap-1">
        <span className="hud-label text-[10px]">{role === "attacker" ? "Attacker" : "Defender"}</span>
        <button
          onClick={handleSave}
          aria-label="Save this set"
          className={`tap-target ml-auto flex h-8 min-w-8 flex-col items-center justify-center rounded-md bg-surface-2 px-1 leading-none ring-1 ring-inset ring-white/5 active:bg-surface ${
            justSaved ? "text-foreground animate-[popPin_.36s_ease-out]" : "text-muted"
          }`}
        >
          <span className="text-[12px] leading-none" aria-hidden>
            {justSaved ? "✓" : "＋"}
          </span>
          <span className="mt-0.5 text-[10px] font-semibold leading-none">
            {justSaved ? "saved" : "save"}
          </span>
        </button>
        {form.preset && (
          <button
            onClick={() => pickForm(state.formIdx)}
            aria-label="Load the meta set"
            className="tap-target flex h-8 min-w-8 flex-col items-center justify-center rounded-md bg-surface-2 px-1 leading-none text-muted ring-1 ring-inset ring-white/5 active:bg-surface"
          >
            <span className="text-[12px] leading-none" aria-hidden>
              ↺
            </span>
            <span className="mt-0.5 text-[10px] font-semibold leading-none">meta</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `radial-gradient(circle at 50% 34%, ${accent}33, ${accent}0d)` }}
        >
          {form.sprite && (
            <Image src={form.sprite} alt={form.label} width={40} height={40} className="size-full object-contain p-0.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Select value={state.slug} onChange={pickMon} className="font-display font-semibold">
            {entries.map((e) => (
              <option key={e.slug} value={e.slug}>{e.name}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {form.types.map((t) => <TypeBadge key={t} type={t} size="sm" />)}
      </div>

      {entry.forms.length > 1 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {entry.forms.map((f, i) => (
            <button
              key={f.key ?? "base"}
              onClick={() => pickForm(i)}
              aria-pressed={i === state.formIdx}
              className={`tap-row rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset transition-colors ${
                i === state.formIdx
                  ? "bg-foreground text-background ring-foreground"
                  : "bg-surface-2 text-muted ring-white/5 active:bg-surface"
              }`}
            >
              {shortFormLabel(f)}
            </button>
          ))}
        </div>
      )}

      {/* set: ability · item · nature · move (stacked in a narrow column) */}
      <div className="mt-2 space-y-1.5">
        <Field label="Ability">
          <Select value={state.ability ?? ""} onChange={(v) => patch({ ability: v })}>
            {form.abilities.map((a) => (
              <option key={a.name} value={a.displayName}>{a.displayName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Item">
          <Select value={state.item} onChange={(v) => patch({ item: v })}>
            {itemOptions.map((it) => <option key={it} value={it}>{it}</option>)}
          </Select>
        </Field>
        <Field label={`Nature${nat ? ` +${nat.up}/−${nat.down}` : ""}`}>
          <Select value={state.nature} onChange={(v) => patch({ nature: v })}>
            {NATURES.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        <Field label="Move">
          <Select value={state.moveSlug} onChange={(v) => patch({ moveSlug: v })}>
            {moveOptions.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.displayName}{m.power ? ` · ${m.power}` : " · —"}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Stat Points */}
      <div className="mt-2">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[9px] uppercase tracking-wider text-muted">Stat Points</span>
          <span className={`font-mono text-[10px] tabular-nums ${spent > SP_BUDGET ? "text-accent" : "text-muted"}`}>
            {spent}/{SP_BUDGET}
          </span>
        </div>
        <StatSliders sp={state.sp} nature={state.nature} onChange={(sp) => patch({ sp })} />
      </div>
    </div>
  );
}

/** Short pill label for a form toggle in a narrow column ("Base", "Mega X", "Mega Z", "Primal"). */
function shortFormLabel(f: CalcForm): string {
  return formPillLabel(f);
}

// --- stat sliders ---------------------------------------------------------------

function StatSliders({
  sp,
  nature,
  onChange,
}: {
  sp: StatPointMap;
  nature: string;
  onChange: (sp: StatPointMap) => void;
}) {
  const nat = natureEffect(nature);
  const spent = totalStatPoints(sp);
  const set = (k: EvStat, raw: number) => {
    const others = spent - (sp[k] ?? 0);
    const max = Math.min(SP_CAP, SP_BUDGET - others);
    const val = Math.max(0, Math.min(max, raw));
    const next = { ...sp };
    if (val > 0) next[k] = val;
    else delete next[k];
    onChange(next);
  };
  const NAT_KEY: Record<EvStat, string> = { hp: "", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
  return (
    <div className="space-y-1">
      {SP_STATS.map((k) => {
        const v = sp[k] ?? 0;
        const up = nat?.up === NAT_KEY[k];
        const down = nat?.down === NAT_KEY[k];
        return (
          <div key={k} className="flex items-center gap-1.5">
            <span className={`w-7 shrink-0 text-[9px] font-medium ${up ? "text-green-300" : down ? "text-accent" : "text-muted"}`}>
              {SP_LABEL[k]}{up ? "+" : down ? "−" : ""}
            </span>
            <input
              type="range"
              min={0}
              max={SP_CAP}
              value={v}
              onChange={(e) => set(k, Number(e.target.value))}
              // .sp-slider (globals.css): 28px grab strip, thin drawn track,
              // 18px neutral thumb — the most-dragged control on the screen
              // was a 6px strip with a red thumb that outshouted the verdict.
              className="sp-slider h-7 min-w-0 flex-1 cursor-pointer"
              aria-label={`${SP_LABEL[k]} stat points`}
            />
            <span className="w-5 shrink-0 text-right font-mono text-[10px] tabular-nums text-foreground/80">{v}</span>
          </div>
        );
      })}
    </div>
  );
}

// --- small controls -------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block truncate text-[9px] uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // text-base, not 13px: pinch-zoom stays enabled (WCAG 1.4.4), so a sub-16px
    // select makes iOS Safari auto-zoom on every one of these ten dropdowns.
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-border bg-surface-2 px-2 py-1 text-base text-foreground outline-none focus:border-foreground/30 ${className}`}
    >
      {children}
    </select>
  );
}

// --- shared field + battle-state console ---------------------------------------
// One aligned table so a modifier reads the same for both sides: a left label,
// then the attacker column and the defender column. Full-width, so the controls
// stay 44px-tappable instead of being crushed into the narrow set panels.

/** One labelled row of mutually exclusive field-condition chips (Weather, Terrain). */
function ChoiceRow<T extends string | null>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <div className="flex flex-1 flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.label}
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={`tap-target rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors ${
              value === o.value
                ? // Neutral on-state: field condition is input, not threat.
                  "bg-white/10 text-foreground ring-white/30"
                : "bg-surface-2 text-muted ring-white/5 active:bg-surface"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FieldControls({
  attacker,
  setAttacker,
  defender,
  setDefender,
  weather,
  setWeather,
  terrain,
  setTerrain,
  spreadInPlay,
  trickRoom,
  setTrickRoom,
  aName,
  dName,
}: {
  attacker: MonState;
  setAttacker: (s: MonState) => void;
  defender: MonState;
  setDefender: (s: MonState) => void;
  weather: Weather;
  setWeather: (w: Weather) => void;
  terrain: Terrain;
  setTerrain: (t: Terrain) => void;
  spreadInPlay: boolean;
  trickRoom: boolean;
  setTrickRoom: (v: boolean) => void;
  aName: string;
  dName: string;
}) {
  const pa = (p: Partial<MonState>) => setAttacker({ ...attacker, ...p });
  const pd = (p: Partial<MonState>) => setDefender({ ...defender, ...p });

  return (
    <div className="rounded-xl glass-quiet p-3">
      <h2 className="hud-label mb-2 text-[11px]">Field &amp; battle state</h2>

      <ChoiceRow label="Weather" options={WEATHERS} value={weather} onChange={setWeather} />
      <ChoiceRow label="Terrain" options={TERRAINS} value={terrain} onChange={setTerrain} />

      <ChoiceRow
        label="Trick Room"
        options={[{ label: "—", value: "off" }, { label: "On · slower first", value: "on" }]}
        value={trickRoom ? "on" : "off"}
        onChange={(v) => setTrickRoom(v === "on")}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_4.75rem] items-center gap-x-2 gap-y-1.5">
        <span />
        <span className="truncate text-center text-[9px] font-semibold uppercase tracking-wide text-foreground/70">{aName}</span>
        <span className="truncate text-center text-[9px] uppercase tracking-wide text-muted">{dName}</span>

        <RowLabel>Atk / SpA</RowLabel>
        <BoostCell label={`Atk / SpA boost — ${aName}`} value={attacker.offBoost} onChange={(v) => pa({ offBoost: v })} />
        <BoostCell label={`Atk / SpA boost — ${dName}`} value={defender.offBoost} onChange={(v) => pd({ offBoost: v })} />

        <RowLabel>Def / SpD</RowLabel>
        <BoostCell label={`Def / SpD boost — ${aName}`} value={attacker.defBoost} onChange={(v) => pa({ defBoost: v })} />
        <BoostCell label={`Def / SpD boost — ${dName}`} value={defender.defBoost} onChange={(v) => pd({ defBoost: v })} />

        <RowLabel>Speed</RowLabel>
        <BoostCell label={`Speed boost — ${aName}`} value={attacker.speBoost} onChange={(v) => pa({ speBoost: v })} />
        <BoostCell label={`Speed boost — ${dName}`} value={defender.speBoost} onChange={(v) => pd({ speBoost: v })} />

        <RowLabel>Burn</RowLabel>
        <ToggleCell label={`Burn — ${aName}`} on={attacker.burn} onClick={() => pa({ burn: !attacker.burn, para: false })} />
        <ToggleCell label={`Burn — ${dName}`} on={defender.burn} onClick={() => pd({ burn: !defender.burn, para: false })} />

        <RowLabel>Paralysis</RowLabel>
        <ToggleCell label={`Paralysis — ${aName}`} on={attacker.para} onClick={() => pa({ para: !attacker.para, burn: false })} />
        <ToggleCell label={`Paralysis — ${dName}`} on={defender.para} onClick={() => pd({ para: !defender.para, burn: false })} />

        <RowLabel>Tailwind</RowLabel>
        <ToggleCell label={`Tailwind — ${aName}'s side`} on={attacker.tailwind} onClick={() => pa({ tailwind: !attacker.tailwind })} />
        <ToggleCell label={`Tailwind — ${dName}'s side`} on={defender.tailwind} onClick={() => pd({ tailwind: !defender.tailwind })} />

        {/* Shown only with a move that reads it (spread moves, Dragon Darts,
            Expanding Force in Psychic Terrain). Each direction reads its
            TARGET side: a lone mon takes full-power spread moves and both
            Dragon Darts, while its partner-backed foe still takes ×0.75 / one dart. */}
        {spreadInPlay && (
          <>
            <RowLabel>Mons on side</RowLabel>
            <SideCell label={aName} value={attacker.sideCount} onChange={(v) => pa({ sideCount: v })} />
            <SideCell label={dName} value={defender.sideCount} onChange={(v) => pd({ sideCount: v })} />
          </>
        )}

        <RowLabel>Screens</RowLabel>
        <ToggleCell label={`Screens — ${aName}`} on={attacker.screens} onClick={() => pa({ screens: !attacker.screens })} />
        <ToggleCell label={`Screens — ${dName}`} on={defender.screens} onClick={() => pd({ screens: !defender.screens })} />

        <RowLabel>Helping Hand</RowLabel>
        <ToggleCell label={`Helping Hand — ${aName}`} on={attacker.helpingHand} onClick={() => pa({ helpingHand: !attacker.helpingHand })} />
        <ToggleCell label={`Helping Hand — ${dName}`} on={defender.helpingHand} onClick={() => pd({ helpingHand: !defender.helpingHand })} />

        <RowLabel>Friend Guard</RowLabel>
        <ToggleCell label={`Friend Guard — ${aName}`} on={attacker.friendGuard} onClick={() => pa({ friendGuard: !attacker.friendGuard })} />
        <ToggleCell label={`Friend Guard — ${dName}`} on={defender.friendGuard} onClick={() => pd({ friendGuard: !defender.friendGuard })} />

        <RowLabel>HP</RowLabel>
        <HpCell label={aName} value={attacker.hpPct} onChange={(v) => pa({ hpPct: v })} />
        <HpCell label={dName} value={defender.hpPct} onChange={(v) => pd({ hpPct: v })} />
      </div>
    </div>
  );
}

/** Pokémon on a side: 2 (default) ⇄ 1 (its partner is gone). */
function SideCell({ label, value, onChange }: { label: string; value: 1 | 2; onChange: (v: 1 | 2) => void }) {
  return (
    <button
      onClick={() => onChange(value === 2 ? 1 : 2)}
      aria-label={`${value === 2 ? "Two" : "One"} Pokémon on ${label}'s side — tap to switch`}
      className={`tap-target w-full rounded-md py-1 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset transition-colors ${
        value === 1 ? "bg-white/10 text-foreground ring-white/30" : "bg-surface-2 text-muted ring-white/5 active:bg-surface"
      }`}
    >
      {value === 2 ? "2 out" : "Alone"}
    </button>
  );
}

function RowLabel({ children }: { children: React.ReactNode }) {
  return <span className="truncate text-[11px] text-muted">{children}</span>;
}

function BoostCell({
  label,
  value,
  onChange,
}: {
  /** which row + which mon, e.g. "Atk / SpA boost — Kingambit" */
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md bg-surface-2 px-1 py-0.5 ring-1 ring-inset ring-white/5">
      <button
        aria-label={`Lower ${label}`}
        onClick={() => onChange(Math.max(-6, value - 1))}
        className="tap-target grid size-5 place-items-center rounded text-muted active:text-foreground"
      >
        −
      </button>
      <span className={`font-mono text-[11px] tabular-nums ${value > 0 ? "text-green-300" : value < 0 ? "text-accent" : "text-foreground/70"}`}>
        {value > 0 ? `+${value}` : value}
      </span>
      <button
        aria-label={`Raise ${label}`}
        onClick={() => onChange(Math.min(6, value + 1))}
        className="tap-target grid size-5 place-items-center rounded text-muted active:text-foreground"
      >
        +
      </button>
    </div>
  );
}

function ToggleCell({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      className={`tap-target w-full rounded-md py-1 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset transition-colors ${
        on
          ? // Neutral on-state: battle-state input, not a threat signal.
            "bg-white/10 text-foreground ring-white/30"
          : "bg-surface-2 text-muted/60 ring-white/5 active:bg-surface"
      }`}
    >
      {on ? "On" : "—"}
    </button>
  );
}

function HpCell({
  label,
  value,
  onChange,
}: {
  /** the mon this HP belongs to */
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const cycle = () => onChange(value <= 25 ? 100 : value - 25); // 100 → 75 → 50 → 25 → 100
  return (
    <button
      onClick={cycle}
      aria-label={`HP ${value}% for ${label} — tap to cycle 100, 75, 50, 25`}
      className="tap-target w-full rounded-md bg-surface-2 py-1 text-center font-mono text-[11px] tabular-nums text-foreground/80 ring-1 ring-inset ring-white/5 active:bg-surface"
    >
      {value}%{" "}
      <span className="text-muted/60" aria-hidden>
        ▾
      </span>
    </button>
  );
}
