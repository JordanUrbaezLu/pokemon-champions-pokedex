import { TypeBadge } from "./TypeBadge";
import { effectiveDefensiveProfile } from "@/lib/type-chart";
import { TYPE_COLORS } from "@/lib/type-meta";
import { prettySmogonName } from "@/lib/format";
import type { ThreatProfile } from "@/lib/threat";
import type { MoveBenchmark, MoveSummary, PokemonType } from "@/lib/types";

/**
 * The Threat Profile: what makes THIS Pokémon dangerous, ranked — and built to
 * be read mid-battle in about a second. Each row is one threat vector: a
 * colored short headline, a one-line detail, and ONE big right-rail number
 * with a caption, so the eye sweeps straight down. Rows backed by a move tap
 * through to the move sheet. Only vectors the ladder data supports appear, so
 * a Kingambit card reads nothing like an Amoonguss card.
 */
export function ThreatProfileCard({
  profile,
  moves,
  usage,
  types,
  abilities,
  ability,
  item,
  benchmarks,
  onOpenMove,
}: {
  profile: ThreatProfile;
  moves: MoveSummary[];
  usage: Record<string, number> | undefined;
  types: PokemonType[];
  /** the form's possible abilities — so the kill shot respects immunities */
  abilities: string[];
  /** most-used ability, e.g. { label: "Defiant", pct: 92 } */
  ability: { label: string; pct: number } | null;
  /** most-used item, e.g. { label: "Focus Sash", pct: 41 } */
  item: { label: string; pct: number } | null;
  /** build-time KO verdicts for its likely moves */
  benchmarks?: MoveBenchmark[];
  onOpenMove: (move: MoveSummary) => void;
}) {
  if (profile.vectors.length === 0) return null;

  // The 4 moves it's actually clicking — the "what's coming" read, right
  // inside the profile so the whole threat picture lives in one card.
  const likely =
    usage && Object.keys(usage).length
      ? [...moves]
          .filter((m) => usage[m.name] != null)
          .sort((a, b) => (usage[b.name] ?? 0) - (usage[a.name] ?? 0))
          .slice(0, 4)
      : [];

  // The counterplay: a 4× weakness is the fastest way to delete this threat —
  // but only when the mon's ability can't negate it (Levitate vs Ground) or
  // halve it (Thick Fat vs Ice), or the green "Kill shot" would send a trainer
  // into a move that does nothing.
  const quad = effectiveDefensiveProfile(types, abilities).quad;

  // The single most lethal precomputed verdict — a damage calc's answer with
  // zero inputs ("Play Rough OHKOs Garchomp +1 · 2HKOs 8 of the top meta").
  const danger = (benchmarks ?? [])
    .map((b) => ({ b, score: b.ohkoCount * 2 + b.twoCount }))
    .sort((a, z) => z.score - a.score)[0]?.b;
  const dangerMove = danger ? moves.find((m) => m.name === danger.move) : undefined;

  return (
    <section className="rounded-2xl glass p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h2 className="text-xs font-black uppercase tracking-wider text-muted">
          Threat Profile
        </h2>
        {profile.archetype.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {profile.archetype.map((a) => (
              <span
                key={a.label}
                className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ backgroundColor: `${a.tone}22`, color: a.tone }}
              >
                {a.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {profile.vectors.map((v) => {
          const move = v.moveSlug
            ? moves.find((m) => m.name === v.moveSlug)
            : undefined;
          const inner = (
            <>
              {/* Tone bar: the vector's kind at a glance. */}
              <span
                className="w-1 shrink-0 self-stretch rounded-full"
                style={{ backgroundColor: v.tone }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 py-0.5">
                <span
                  className="block text-[13.5px] font-bold leading-tight"
                  style={{ color: v.tone }}
                >
                  {v.headline}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                  {v.detail}
                </span>
              </span>
              {/* The one number worth scanning, big, on a steady right rail. */}
              {v.stat && (
                <span className="flex w-13 shrink-0 flex-col items-end justify-center text-right">
                  <span className="text-[17px] font-extrabold leading-none tabular-nums">
                    {v.stat.value}
                  </span>
                  <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {v.stat.caption}
                  </span>
                </span>
              )}
              {move && (
                <span className="shrink-0 self-center text-muted" aria-hidden>
                  ›
                </span>
              )}
            </>
          );
          return move ? (
            <button
              key={v.headline}
              type="button"
              onClick={() => onOpenMove(move)}
              className="flex w-full items-stretch gap-2.5 rounded-xl bg-surface px-2.5 py-2 text-left active:bg-surface-2"
            >
              {inner}
            </button>
          ) : (
            <div
              key={v.headline}
              className="flex items-stretch gap-2.5 rounded-xl bg-surface px-2.5 py-2"
            >
              {inner}
            </div>
          );
        })}
      </div>

      {likely.length > 0 && (
        <div className="mt-2.5 border-t border-border pt-2">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
            Likely set
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {likely.map((m) => (
              <button
                key={m.name}
                type="button"
                onClick={() => onOpenMove(m)}
                className="relative flex items-center gap-1.5 overflow-hidden rounded-lg bg-surface px-2 py-1.5 text-left active:bg-surface-2"
              >
                {/* Proportion bar: usage at a glance, behind the row. */}
                <span
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${usage?.[m.name] ?? 0}%`,
                    backgroundColor: TYPE_COLORS[m.type],
                    opacity: 0.13,
                  }}
                  aria-hidden
                />
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: TYPE_COLORS[m.type] }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold leading-tight">
                  {m.displayName}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] font-bold tabular-nums text-muted">
                  {usage?.[m.name]}%
                </span>
              </button>
            ))}
          </div>
          {danger && dangerMove && (
            <button
              type="button"
              onClick={() => onOpenMove(dangerMove)}
              className="mt-1.5 w-full px-0.5 text-left text-[11px] leading-snug text-muted active:opacity-70"
            >
              <span className="font-bold text-accent">{dangerMove.displayName}</span>{" "}
              {danger.ohkoCount > 0 && (
                <>
                  OHKOs{" "}
                  <span className="font-semibold text-foreground/90">
                    {prettySmogonName(danger.ohko[0])}
                    {danger.ohkoCount > 1 ? ` +${danger.ohkoCount - 1}` : ""}
                  </span>
                  {danger.twoCount > 0 && " · "}
                </>
              )}
              {danger.twoCount > 0 && <>2HKOs {danger.twoCount} of the top meta</>}
              <span aria-hidden>{" ›"}</span>
            </button>
          )}
          {(ability || item) && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 px-0.5 text-[11px] text-muted">
              {ability && (
                <span>
                  <span className="font-semibold text-foreground/90">{ability.label}</span>{" "}
                  <span className="font-mono tabular-nums">{ability.pct}%</span>
                </span>
              )}
              {item && (
                <span>
                  <span className="font-semibold text-foreground/90">{item.label}</span>{" "}
                  <span className="font-mono tabular-nums">{item.pct}%</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {quad.length > 0 && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-500/10 px-2.5 py-1.5">
          <span className="text-[11px] font-black uppercase tracking-wide text-green-300">
            Kill shot
          </span>
          <span className="text-[11px] font-semibold text-green-100/90">
            4× weak to
          </span>
          <span className="flex gap-1">
            {quad.map((t) => (
              <TypeBadge key={t} type={t} size="sm" />
            ))}
          </span>
        </div>
      )}
    </section>
  );
}
