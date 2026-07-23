import { STAT_LABELS, type StatKey } from "@/lib/format";
import { lv50Stats } from "@/lib/battle";
import type { CompetitiveSpread, PokemonStats } from "@/lib/types";

const STAT_ORDER: StatKey[] = [
  "hp",
  "attack",
  "defense",
  "specialAttack",
  "specialDefense",
  "speed",
];

/** Color a stat by how good it is, for an instant read of the spread.
 *  A single amber hue stepped by luminance (colorblind-safe): magnitude is
 *  brightness, never hue — red stays threat-only, green stays kill-shot-only. */
function statColor(value: number): string {
  if (value < 60) return "#8a5c0a";
  if (value < 90) return "#b47c0b";
  if (value < 110) return "#d69a0e";
  if (value < 130) return "#f0b429";
  return "#ffd25e";
}

// Bars are scaled against a visual max a touch above the highest practical base
// stat, so even big numbers leave a little headroom and stay comparable.
const VISUAL_MAX = 200;

// A neutral nature folds out, so this gives each stat's L50 value from the
// common spread's EVs alone — the shadow shows the EV investment, not nature.
const NEUTRAL_NATURE = "Hardy";

/**
 * Six base-stat bars plus the total. The right column is each stat's plain
 * Level-50 value (31 IVs, **no EVs / neutral nature**) — a clean baseline that
 * isn't skewed by one set's spread. When a common spread is known, a lighter
 * "shadow" extends each bar by the stat's EV investment, without putting a
 * misleading number in the column.
 */
export function StatBars({
  stats,
  spread,
}: {
  stats: PokemonStats;
  spread?: CompetitiveSpread | null;
}) {
  const neutral = lv50Stats(stats, null);
  const withEvs = spread
    ? lv50Stats(stats, { nature: NEUTRAL_NATURE, evs: spread.evs })
    : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wide text-muted">
        <span className="w-9 shrink-0" />
        <span className="w-9 shrink-0 text-right">Base</span>
        <div className="flex-1" />
        <span className="w-9 shrink-0 text-right">Lv. 50</span>
      </div>
      <div className="flex flex-col gap-3.5 pt-1">
        {STAT_ORDER.map((key) => {
          const value = stats[key];
          const color = statColor(value);
          const basePct = Math.min(100, (value / VISUAL_MAX) * 100);
          // The L50 formula's constant offset cancels, so (EV value − neutral value)
          // is exactly the stat's base-equivalent gain from the EVs — this is the
          // "+N" shown above the lighter bar.
          const gain = withEvs ? Math.max(0, withEvs[key] - neutral[key]) : 0;
          const shadowPct = Math.min(100 - basePct, (gain / VISUAL_MAX) * 100);
          const hasShadow = shadowPct > 0.5;
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="w-9 shrink-0 font-mono text-xs font-semibold text-muted">
                {STAT_LABELS[key]}
              </span>
              <span className="w-9 shrink-0 text-right font-mono text-sm tabular-nums text-muted">
                {value}
              </span>
              <div className="relative flex-1">
                {/* What the EVs add at Lv 50, floating above the lighter bar. */}
                {hasShadow && (
                  <span
                    className="pointer-events-none absolute -top-3 -translate-x-1/2 text-[10px] font-bold leading-none tabular-nums"
                    style={{ left: `${Math.min(95, basePct + shadowPct / 2)}%`, color }}
                  >
                    +{gain}
                  </span>
                )}
                <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-2">
                  {/* Lighter EV "shadow" runs underneath, from 0 to base+gain, so it
                      stays connected to the solid bar and rounds off on the right. */}
                  {hasShadow && (
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                      style={{
                        width: `${Math.min(100, basePct + shadowPct)}%`,
                        backgroundColor: color,
                        opacity: 0.32,
                      }}
                    />
                  )}
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                    style={{ width: `${basePct}%`, backgroundColor: color }}
                  />
                </div>
              </div>
              <span className="w-9 shrink-0 text-right font-mono text-sm font-bold tabular-nums">
                {neutral[key]}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-sm">
        <span className="font-semibold text-muted">Base Stat Total</span>
        <span className="font-mono font-bold tabular-nums">{stats.total}</span>
      </div>
    </div>
  );
}
