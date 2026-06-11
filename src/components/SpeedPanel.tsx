"use client";

import { useMemo, useState } from "react";
import { applySpeedMods, speedAnchors, SPEED_MODS } from "@/lib/battle";
import type { CompetitiveProfile, PokemonStats } from "@/lib/types";

/** "252 EVs" in the game's own Stat Point units. */
const toSP = (evs: number) => Math.round(evs / 8);

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
}: {
  stats: PokemonStats;
  comp: CompetitiveProfile | undefined;
}) {
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());
  const [trickRoom, setTrickRoom] = useState(false);

  const anchors = useMemo(() => speedAnchors(stats, comp?.spread), [stats, comp]);

  const modded = useMemo(
    () => ({
      max: applySpeedMods(anchors.max, active),
      common: anchors.common != null ? applySpeedMods(anchors.common, active) : null,
      min: applySpeedMods(anchors.min, active),
    }),
    [anchors, active],
  );

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
    <section className="rounded-2xl border border-border bg-surface/60 p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-black uppercase tracking-wider text-muted">Speed</h2>
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

      <div className="no-scrollbar -mx-3.5 mt-2.5 flex gap-1.5 overflow-x-auto px-3.5">
        {SPEED_MODS.map((mod) => {
          const on = active.has(mod.id);
          const isScarfTell = mod.id === "scarf" && scarfPct >= 25;
          return (
            <button
              key={mod.id}
              type="button"
              onClick={() => toggle(mod.id)}
              aria-pressed={on}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                on
                  ? "bg-accent text-white"
                  : isScarfTell
                    ? "border border-accent/60 bg-surface-2 text-accent"
                    : "bg-surface-2 text-muted"
              }`}
            >
              {mod.label}
              {isScarfTell && !on && (
                <span className="font-mono tabular-nums"> {scarfPct}%</span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setTrickRoom((t) => !t)}
          aria-pressed={trickRoom}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
            trickRoom ? "bg-sky-500 text-white" : "bg-surface-2 text-muted"
          }`}
        >
          TR
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
