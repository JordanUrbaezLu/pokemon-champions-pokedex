"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HomeIcon } from "./HomeIcon";
import { TypeBadge } from "./TypeBadge";
import { computeDamage, moveToCalcMove, type CalcField, type CalcPokemon, type DamageResult, type Weather } from "@/lib/damage";
import { lv50Stats } from "@/lib/battle";
import { NATURES, natureEffect } from "@/lib/format";
import {
  SP_BUDGET, SP_CAP, SP_STATS, statPointsToSpread, totalStatPoints, type StatPointMap,
} from "@/lib/stat-points";
import { TYPE_COLORS } from "@/lib/type-meta";
import { useCalcSets, type SavedSet } from "@/lib/calc-sets";
import type { CalcEntry, CalcForm, CalcIndex, CalcMoveLite } from "@/lib/calc-data";
import type { EvStat } from "@/lib/types";

// Items that change the damage math (others are cosmetic on this screen).
const ITEMS = [
  "None", "Life Orb", "Choice Band", "Choice Specs", "Choice Scarf", "Assault Vest",
  "Eviolite", "Expert Belt", "Focus Sash", "Sitrus Berry", "Leftovers", "Rocky Helmet",
  "Safety Goggles", "Covert Cloak", "Booster Energy",
] as const;

const WEATHERS: { label: string; value: Weather }[] = [
  { label: "—", value: null }, { label: "☀ Sun", value: "Sun" }, { label: "🌧 Rain", value: "Rain" },
  { label: "🏜 Sand", value: "Sand" }, { label: "❄ Snow", value: "Snow" },
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
  burn: boolean;
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
    item: preset?.item ?? "None",
    moveSlug: preset?.topMoves[0] ?? entry.moveSlugs[0] ?? "",
    offBoost: 0,
    defBoost: 0,
    burn: false,
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
    name: form.smogonName,
    types: form.types,
    baseStats: form.stats,
    ability: state.ability,
    item: state.item !== "None" ? state.item : null,
    nature: state.nature,
    evs: spread.evs,
    boosts: { atk: state.offBoost, spa: state.offBoost, def: state.defBoost, spd: state.defBoost },
    status: state.burn ? "brn" : null,
    curHpPct: state.hpPct,
    weightKg: form.weightKg,
  };
}

function speedOf(state: MonState, entry: CalcEntry): number {
  const form = formOf(entry, state.formIdx);
  return lv50Stats(form.stats, statPointsToSpread(state.nature, state.sp)).speed;
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
    item: set.item,
    moveSlug: set.moveSlug,
  };
}

export function Calc({ index }: { index: CalcIndex }) {
  const bySlug = useMemo(() => {
    const m = new Map<string, CalcEntry>();
    for (const e of index.entries) m.set(e.slug, e);
    return m;
  }, [index]);

  const first = index.entries[0];
  const second = index.entries[1] ?? first;
  const [attacker, setAttacker] = useState<MonState>(() => defaultMon(first));
  const [defender, setDefender] = useState<MonState>(() => defaultMon(second));
  const [weather, setWeather] = useState<Weather>(null);
  const { sets, saveSet, removeSet } = useCalcSets();

  const loadInto = (side: "attacker" | "defender", set: SavedSet) => {
    const state = monStateFromSet(set, bySlug);
    if (!state) return;
    (side === "attacker" ? setAttacker : setDefender)(state);
  };

  // Seed context from the URL (?a=slug&d=slug) so other screens can deep-link a
  // matchup into the calc. Deliberately in an effect, not a lazy initializer:
  // the page is statically prerendered with defaults, so reading the query
  // during render would cause a hydration mismatch. Runs once on mount.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const a = q.get("a");
    const d = q.get("d");
    /* eslint-disable react-hooks/set-state-in-effect */
    if (a && bySlug.has(a)) setAttacker(defaultMon(bySlug.get(a)!));
    if (d && bySlug.has(d)) setDefender(defaultMon(bySlug.get(d)!));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [bySlug]);

  const aEntry = bySlug.get(attacker.slug) ?? first;
  const dEntry = bySlug.get(defender.slug) ?? second;

  const aMon = toCalcPokemon(attacker, aEntry);
  const dMon = toCalcPokemon(defender, dEntry);
  const aMove = index.moves[attacker.moveSlug];
  const dMove = index.moves[defender.moveSlug];

  const fwdField: CalcField = {
    gameType: "Doubles", weather,
    helpingHand: attacker.helpingHand, auroraVeil: defender.screens, friendGuard: defender.friendGuard,
  };
  const backField: CalcField = {
    gameType: "Doubles", weather,
    helpingHand: defender.helpingHand, auroraVeil: attacker.screens, friendGuard: attacker.friendGuard,
  };

  const forward = calcOf(aMon, dMon, aMove, fwdField);
  const back = calcOf(dMon, aMon, dMove, backField);

  const aSpeed = speedOf(attacker, aEntry);
  const dSpeed = speedOf(defender, dEntry);

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
            <h1 className="hud-label text-[13px]">Battle Calc</h1>
            <p className="truncate text-[11px] text-muted">Doubles · Lv 50 · {index.bracketLabel} sets</p>
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
            {aSpeed === dSpeed
              ? `Speed tie · ${aSpeed}`
              : aSpeed > dSpeed
                ? `${aEntry.name} moves first · ${aSpeed} vs ${dSpeed}`
                : `${dEntry.name} moves first · ${dSpeed} vs ${aSpeed}`}
            <span className="text-muted/60">(Lv50 base speed)</span>
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
                  <button
                    onClick={() => loadInto("attacker", s)}
                    className="tap-target rounded-md bg-surface-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted ring-1 ring-inset ring-white/5 active:bg-surface"
                  >
                    → Atk
                  </button>
                  <button
                    onClick={() => loadInto("defender", s)}
                    className="tap-target rounded-md bg-surface-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted ring-1 ring-inset ring-white/5 active:bg-surface"
                  >
                    → Def
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
        Fissure, Fling…) show “not calculated”. No Terastallization; no live calls.
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
  return computeDamage(attacker, defender, calcMove, field);
}

// --- verdict --------------------------------------------------------------------

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
  const label = result && !result.immune ? result.verdict.label : null;
  const kills = label != null && (label === "OHKO" || label.startsWith("OHKO"));
  const twoHit = label != null && label.startsWith("2HKO");
  // The green Kill-shot pill = "you KO it"; accent = "it KOs you"; amber = a
  // roll-dependent 2HKO — the app's existing color grammar, reused verbatim.
  const pill =
    !result || result.immune
      ? "border-border bg-surface-2 text-muted"
      : kills
        ? tone === "hit"
          ? "border-green-500/40 bg-green-500/10 text-green-300"
          : "border-accent/40 bg-accent/10 text-accent"
        : twoHit
          ? "border-amber-300/40 bg-amber-300/10 text-amber-300"
          : "border-border bg-surface-2 text-foreground/80";
  const partialOhko =
    result && !result.immune && !result.verdict.guaranteed &&
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
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {!result ? (
          <span className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            not calculated
          </span>
        ) : result.immune ? (
          <span className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
            No effect
          </span>
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

  const moveOptions = entry.moveSlugs
    .map((s) => moves[s])
    .filter((m): m is CalcMoveLite => !!m);

  return (
    <div className="rounded-xl glass p-2.5" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="mb-1.5 flex items-center gap-1">
        <span className="hud-label text-[10px]">{role === "attacker" ? "Attacker" : "Defender"}</span>
        <button
          onClick={onSave}
          aria-label="Save this set"
          className="tap-target ml-auto grid size-6 place-items-center rounded-md bg-surface-2 text-[13px] leading-none text-muted ring-1 ring-inset ring-white/5 active:bg-surface"
        >
          ＋
        </button>
        {form.preset && (
          <button
            onClick={() => pickForm(state.formIdx)}
            aria-label="Load the meta set"
            className="tap-target grid size-6 place-items-center rounded-md bg-surface-2 text-[13px] leading-none text-muted ring-1 ring-inset ring-white/5 active:bg-surface"
          >
            ↺
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
          <Select value={state.slug} onChange={pickMon} className="font-display text-[13px] font-semibold">
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
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset transition-colors ${
                i === state.formIdx ? "bg-accent text-white ring-accent" : "bg-surface-2 text-muted ring-white/5 active:bg-surface"
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
            {ITEMS.map((it) => <option key={it} value={it}>{it}</option>)}
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

/** Short pill label for a form toggle in a narrow column. */
function shortFormLabel(f: CalcForm): string {
  if (!f.key) return "Base";
  if (f.isMega) {
    if (/\bX$/.test(f.label)) return "Mega X";
    if (/\bY$/.test(f.label)) return "Mega Y";
    return f.label.includes("Primal") ? "Primal" : "Mega";
  }
  return f.label;
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
              className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-surface-2 accent-accent"
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
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[13px] text-foreground outline-none focus:border-accent/60 ${className}`}
    >
      {children}
    </select>
  );
}

// --- shared field + battle-state console ---------------------------------------
// One aligned table so a modifier reads the same for both sides: a left label,
// then the attacker column and the defender column. Full-width, so the controls
// stay 44px-tappable instead of being crushed into the narrow set panels.

function FieldControls({
  attacker,
  setAttacker,
  defender,
  setDefender,
  weather,
  setWeather,
  aName,
  dName,
}: {
  attacker: MonState;
  setAttacker: (s: MonState) => void;
  defender: MonState;
  setDefender: (s: MonState) => void;
  weather: Weather;
  setWeather: (w: Weather) => void;
  aName: string;
  dName: string;
}) {
  const pa = (p: Partial<MonState>) => setAttacker({ ...attacker, ...p });
  const pd = (p: Partial<MonState>) => setDefender({ ...defender, ...p });

  return (
    <div className="rounded-xl glass-quiet p-3">
      <h2 className="hud-label mb-2 text-[11px]">Field &amp; battle state</h2>

      <div className="mb-3 flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-muted">Weather</span>
        <div className="flex flex-1 flex-wrap gap-1">
          {WEATHERS.map((w) => (
            <button
              key={w.label}
              onClick={() => setWeather(w.value)}
              className={`tap-target rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors ${
                weather === w.value
                  ? "bg-accent/15 text-accent ring-accent/40"
                  : "bg-surface-2 text-muted ring-white/5 active:bg-surface"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_4.75rem] items-center gap-x-2 gap-y-1.5">
        <span />
        <span className="truncate text-center text-[9px] font-semibold uppercase tracking-wide text-foreground/70">{aName}</span>
        <span className="truncate text-center text-[9px] uppercase tracking-wide text-muted">{dName}</span>

        <RowLabel>Atk / SpA</RowLabel>
        <BoostCell value={attacker.offBoost} onChange={(v) => pa({ offBoost: v })} />
        <BoostCell value={defender.offBoost} onChange={(v) => pd({ offBoost: v })} />

        <RowLabel>Def / SpD</RowLabel>
        <BoostCell value={attacker.defBoost} onChange={(v) => pa({ defBoost: v })} />
        <BoostCell value={defender.defBoost} onChange={(v) => pd({ defBoost: v })} />

        <RowLabel>Burn</RowLabel>
        <ToggleCell on={attacker.burn} onClick={() => pa({ burn: !attacker.burn })} />
        <ToggleCell on={defender.burn} onClick={() => pd({ burn: !defender.burn })} />

        <RowLabel>Screens</RowLabel>
        <ToggleCell on={attacker.screens} onClick={() => pa({ screens: !attacker.screens })} />
        <ToggleCell on={defender.screens} onClick={() => pd({ screens: !defender.screens })} />

        <RowLabel>Helping Hand</RowLabel>
        <ToggleCell on={attacker.helpingHand} onClick={() => pa({ helpingHand: !attacker.helpingHand })} />
        <ToggleCell on={defender.helpingHand} onClick={() => pd({ helpingHand: !defender.helpingHand })} />

        <RowLabel>Friend Guard</RowLabel>
        <ToggleCell on={attacker.friendGuard} onClick={() => pa({ friendGuard: !attacker.friendGuard })} />
        <ToggleCell on={defender.friendGuard} onClick={() => pd({ friendGuard: !defender.friendGuard })} />

        <RowLabel>HP</RowLabel>
        <HpCell value={attacker.hpPct} onChange={(v) => pa({ hpPct: v })} />
        <HpCell value={defender.hpPct} onChange={(v) => pd({ hpPct: v })} />
      </div>
    </div>
  );
}

function RowLabel({ children }: { children: React.ReactNode }) {
  return <span className="truncate text-[11px] text-muted">{children}</span>;
}

function BoostCell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-surface-2 px-1 py-0.5 ring-1 ring-inset ring-white/5">
      <button
        aria-label="Lower"
        onClick={() => onChange(Math.max(-6, value - 1))}
        className="tap-target grid size-5 place-items-center rounded text-muted active:text-foreground"
      >
        −
      </button>
      <span className={`font-mono text-[11px] tabular-nums ${value > 0 ? "text-green-300" : value < 0 ? "text-accent" : "text-foreground/70"}`}>
        {value > 0 ? `+${value}` : value}
      </span>
      <button
        aria-label="Raise"
        onClick={() => onChange(Math.min(6, value + 1))}
        className="tap-target grid size-5 place-items-center rounded text-muted active:text-foreground"
      >
        +
      </button>
    </div>
  );
}

function ToggleCell({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`tap-target w-full rounded-md py-1 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset transition-colors ${
        on ? "bg-accent/15 text-accent ring-accent/40" : "bg-surface-2 text-muted/60 ring-white/5 active:bg-surface"
      }`}
    >
      {on ? "On" : "—"}
    </button>
  );
}

function HpCell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const cycle = () => onChange(value <= 25 ? 100 : value - 25); // 100 → 75 → 50 → 25 → 100
  return (
    <button
      onClick={cycle}
      className="tap-target w-full rounded-md bg-surface-2 py-1 text-center font-mono text-[11px] tabular-nums text-foreground/80 ring-1 ring-inset ring-white/5 active:bg-surface"
    >
      {value}%
    </button>
  );
}
