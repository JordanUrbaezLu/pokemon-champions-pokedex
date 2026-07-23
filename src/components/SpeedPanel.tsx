"use client";

import { useMemo, useState } from "react";
import { applySpeedMods, speedAnchors, SPEED_MODS } from "@/lib/battle";
import type { CompetitiveProfile, PokemonStats } from "@/lib/types";

/** "252 EVs" in the game's own Stat Point units. */
const toSP = (evs: number) => Math.round(evs / 8);

const stripId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Abilities that multiply Speed under a condition. Without these, a sun-team
 * Venusaur reads Max=Common=145 when Chlorophyll actually makes it 290 — a
 * flatly wrong answer to "do I outspeed?". Offered as conditional one-tap
 * modifiers, labelled with the trigger, only when the form owns the ability.
 */
const ABILITY_SPEED_MODS: Record<string, { label: string; effect: string; mult: number }> = {
  chlorophyll: { label: "Chlorophyll", effect: "sun ×2", mult: 2 },
  swiftswim: { label: "Swift Swim", effect: "rain ×2", mult: 2 },
  sandrush: { label: "Sand Rush", effect: "sand ×2", mult: 2 },
  slushrush: { label: "Slush Rush", effect: "snow ×2", mult: 2 },
  surgesurfer: { label: "Surge Surfer", effect: "E-terrain ×2", mult: 2 },
  unburden: { label: "Unburden", effect: "item used ×2", mult: 2 },
  quickfeet: { label: "Quick Feet", effect: "status ×1.5", mult: 1.5 },
};

/**
 * The "do I outspeed?" panel — the most-asked mid-battle question. Champions
 * fixes IVs (31) and level (50), so MIN / COMMON / MAX are provable bounds,
 * not estimates. One-tap modifiers (Icy Wind, Scarf, Tailwind, para, Trick
 * Room) re-answer the question the moment the field changes, and the
 * speed-shape line reads the FULL spread distribution so bimodal mons
 * (max-Speed half the time, Trick-Room-min the other half) can't lie.
 */
export function SpeedPanel({
  stats,
  comp,
  abilities = [],
}: {
  stats: PokemonStats;
  comp: CompetitiveProfile | undefined;
  /** the form's ability slugs — surfaces conditional ability speed-doublers */
  abilities?: readonly string[];
}) {
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());
  const [trickRoom, setTrickRoom] = useState(false);

  const anchors = useMemo(() => speedAnchors(stats, comp?.spread), [stats, comp]);

  // Ability speed-doublers this form can own (Chlorophyll, Swift Swim, …).
  const abilityMods = useMemo(
    () =>
      abilities
        .map((a) => {
          const spec = ABILITY_SPEED_MODS[stripId(a)];
          return spec ? { id: `ab:${stripId(a)}`, ...spec } : null;
        })
        .filter((m): m is NonNullable<typeof m> => m != null),
    [abilities],
  );

  const modded = useMemo(() => {
    // Built-in field mods (Icy Wind/Scarf/Tailwind/Para) first, then any active
    // ability doubler — each floored, the way the game chains speed modifiers.
    const apply = (base: number) => {
      let v = applySpeedMods(base, active);
      for (const m of abilityMods) {
        if (active.has(m.id)) v = Math.floor(v * m.mult);
      }
      return v;
    };
    return {
      max: apply(anchors.max),
      common: anchors.common != null ? apply(anchors.common) : null,
      min: apply(anchors.min),
    };
  }, [anchors, active, abilityMods]);

  const toggle = (id: string) => {
    const next = new Set(active);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setActive(next);
  };

  const scarfPct = comp?.itemClasses?.scarf ?? 0;
  const invest = comp?.speedInvest;

  // One-line read of the FULL spread distribution.
  const shape = useMemo(() => {
    if (!invest) return null;
    if (invest.minus >= 30)
      return { text: `${invest.minus}% run a −Spe nature — expect Trick Room pace`, warn: true };
    if (invest.max >= 60) return { text: `${invest.max}% run max Speed`, warn: false };
    const slow = invest.none + invest.minus;
    if (slow >= 50) return { text: `${slow}% run no Speed investment`, warn: false };
    return {
      text: `Split Speed: ${invest.max}% max · ${slow}% none`,
      warn: invest.minus >= 15,
    };
  }, [invest]);

  return (
    <section className="rounded-2xl glass p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="hud-label text-[11px]">Speed</h2>
        <span className="text-[10px] text-muted">
          Lv. 50 · 31 IVs{trickRoom ? " · Trick Room: slower acts first" : ""}
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
        {(
          [
            { key: "min", label: "Min", value: modded.min, sp: "0 SP −Spe" },
            {
              key: "common",
              label: "Common",
              value: modded.common,
              sp:
                comp?.spread?.evs.spe != null
                  ? `${toSP(comp.spread.evs.spe)} SP`
                  : comp?.spread
                    ? "0 SP"
                    : null,
            },
            { key: "max", label: "Max", value: modded.max, sp: "32 SP +Spe" },
          ] as const
        ).map((a) => {
          // Under Trick Room the threat inverts: MIN is what acts first.
          const hot = trickRoom ? a.key === "min" : a.key === "common";
          return (
            <div
              key={a.key}
              className={`rounded-xl py-2 ${
                hot && a.value != null
                  ? "border border-accent/40 bg-accent/10"
                  : "bg-surface-2"
              }`}
            >
              <div
                className={`font-mono text-xl font-bold tabular-nums ${
                  hot && a.value != null ? "text-accent" : ""
                }`}
              >
                {a.value ?? "—"}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted">
                {a.label}
                {a.sp ? ` · ${a.sp}` : ""}
              </div>
            </div>
          );
        })}
      </div>

      {/* What changes its Speed — spelled out, one tap each, wraps naturally. */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {SPEED_MODS.map((mod) => {
          const on = active.has(mod.id);
          const isScarfTell = mod.id === "scarf" && scarfPct >= 25;
          return (
            <button
              key={mod.id}
              type="button"
              onClick={() => toggle(mod.id)}
              aria-pressed={on}
              className={`tap-row rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                on
                  ? "bg-accent text-white"
                  : isScarfTell
                    ? "border border-accent/60 bg-surface-2 text-accent"
                    : "bg-surface-2 text-muted"
              }`}
            >
              {mod.label}{" "}
              <span className={on ? "text-white/70" : "opacity-60"}>
                {isScarfTell && !on ? `${scarfPct}%` : mod.effect}
              </span>
            </button>
          );
        })}
        {/* Conditional ability doublers — amber to signal "only if it has this
            ability and the trigger is up", distinct from the always-true field
            mods above. */}
        {abilityMods.map((mod) => {
          const on = active.has(mod.id);
          return (
            <button
              key={mod.id}
              type="button"
              onClick={() => toggle(mod.id)}
              aria-pressed={on}
              className={`tap-row rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                on
                  ? "bg-amber-400 text-black"
                  : "border border-amber-400/50 bg-surface-2 text-amber-300"
              }`}
            >
              {mod.label}{" "}
              <span className={on ? "text-black/70" : "opacity-70"}>{mod.effect}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setTrickRoom((t) => !t)}
          aria-pressed={trickRoom}
          // Violet (the move's own Psychic flavor), not sky — cyan belongs to
          // exactly one concept app-wide: "new to Champions".
          className={`tap-row rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
            trickRoom ? "bg-violet-500 text-white" : "bg-surface-2 text-muted"
          }`}
        >
          Trick Room
        </button>
      </div>

      {shape && (
        <p
          className={`mt-2 text-[11px] font-semibold ${
            shape.warn ? "text-amber-300" : "text-muted"
          }`}
        >
          {shape.text}
        </p>
      )}
    </section>
  );
}
