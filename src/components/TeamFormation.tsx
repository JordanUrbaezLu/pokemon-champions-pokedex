import Image from "next/image";
import { MegaIcon } from "./MegaIcon";
import { TYPE_COLORS } from "@/lib/type-meta";
import type { MetaTeamMember } from "@/lib/types";

const NEUTRAL = "#5b6675";

/**
 * The signature element: a team's elemental "fingerprint" — a hard-banded
 * spectrum of each member's primary-type color, so a Rain team reads blue and a
 * Sun team reads orange at a glance. Reused as the sprite tiles' aura and the
 * readout line beneath them, and as the card's ambient wash.
 */
export function teamSpectrum(members: MetaTeamMember[]): string {
  const n = members.length || 1;
  const bands = members.map((m, i) => {
    const c = TYPE_COLORS[m.types[0]] ?? NEUTRAL;
    return `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`;
  });
  return `linear-gradient(90deg, ${bands.join(", ")})`;
}

/**
 * The six-mon formation: type-tinted sprite tiles over the team's own color
 * spectrum, with a spectrum readout line below. The corner ticks echo the
 * detail hero's target-lock reticle so the whole app reads as one instrument.
 */
export function TeamFormation({
  members,
  labelled = false,
}: {
  members: MetaTeamMember[];
  /** Show each mon's short form label under its tile (detail header). */
  labelled?: boolean;
}) {
  const spectrum = teamSpectrum(members);
  return (
    <div className="relative">
      {/* Corner ticks — the reticle motif framing the squad. */}
      <span aria-hidden className="pointer-events-none absolute -left-1 -top-1 size-2.5 rounded-tl border-l-2 border-t-2 border-white/25" />
      <span aria-hidden className="pointer-events-none absolute -right-1 -top-1 size-2.5 rounded-tr border-r-2 border-t-2 border-white/25" />

      <div className="grid grid-cols-6 gap-1">
        {members.map((m, i) => {
          const accent = TYPE_COLORS[m.types[0]] ?? NEUTRAL;
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <div
                className="relative flex aspect-square w-full items-center justify-center rounded-lg"
                style={{
                  background: `radial-gradient(circle at 50% 34%, ${accent}33, ${accent}0d)`,
                  boxShadow: m.isMega
                    ? `inset 0 0 0 1.5px ${accent}, inset 0 0 0 2.5px rgba(255,255,255,0.12)`
                    : `inset 0 0 0 1px ${accent}30`,
                }}
              >
                {m.sprite ? (
                  <Image
                    src={m.sprite}
                    alt={m.formLabel}
                    width={56}
                    height={56}
                    className="size-full object-contain p-[3px]"
                    loading="eager"
                  />
                ) : (
                  <span className="text-[9px] font-bold text-muted">{m.name.slice(0, 3)}</span>
                )}
                {m.isMega && (
                  <MegaIcon className="absolute -right-1 -top-1 size-3.5 drop-shadow-[0_0_2px_rgba(0,0,0,0.6)]" />
                )}
              </div>
              {labelled && (
                <span className="max-w-full truncate text-[9px] leading-tight text-muted">
                  {m.formLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Team spectrum readout line. */}
      <div
        aria-hidden
        className="mt-2 h-[3px] w-full rounded-full opacity-80"
        style={{ background: spectrum }}
      />
    </div>
  );
}
