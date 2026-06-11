import type { ThreatProfile } from "@/lib/threat";
import type { MoveSummary } from "@/lib/types";

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
  onOpenMove,
}: {
  profile: ThreatProfile;
  moves: MoveSummary[];
  onOpenMove: (move: MoveSummary) => void;
}) {
  if (profile.vectors.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-3.5">
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
                <span className="flex w-12 shrink-0 flex-col items-end justify-center text-right">
                  <span className="font-mono text-[15px] font-bold leading-none tabular-nums">
                    {v.stat.value}
                  </span>
                  <span className="mt-0.5 text-[8px] uppercase tracking-wide text-muted">
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
    </section>
  );
}
