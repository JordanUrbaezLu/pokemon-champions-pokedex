import Image from "next/image";
import Link from "next/link";
import { TypeBadge } from "./TypeBadge";
import { MegaIcon } from "./MegaIcon";
import { TYPE_COLORS } from "@/lib/type-meta";
import { formatPickRate, natureEffect } from "@/lib/format";
import type { MetaTeamMember, PokemonType } from "@/lib/types";

/**
 * One Pokémon's full set on a meta team — item, ability, nature, Stat-Point
 * spread, and four moves, exactly as the source paste lists them. The name
 * links into the mon's own scouting page (its form deep-linked) so a trainer
 * can go from "who's on this team" to "how do I beat it" in one tap.
 */
export function TeamSetCard({
  member,
  moveTypes,
}: {
  member: MetaTeamMember;
  /** move display name → type, resolved server-side; dots are skipped when a
   *  move can't be mapped, so an odd paste never breaks the card */
  moveTypes?: Record<string, PokemonType>;
}) {
  const accent = TYPE_COLORS[member.types[0]] ?? "#5b6675";
  const href = member.slug
    ? `/pokemon/${member.slug}${member.formKey ? `?form=${member.formKey}` : ""}`
    : null;

  const Heading = (
    <span className="flex items-center gap-1.5">
      <span className="font-display text-[15px] font-bold leading-tight">{member.formLabel}</span>
      {member.isMega && <MegaIcon className="size-4" />}
    </span>
  );

  return (
    <div
      className="glass-quiet rounded-xl p-3"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex gap-3">
        <div
          className="flex size-16 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `radial-gradient(circle at 50% 34%, ${accent}33, ${accent}0d)` }}
        >
          {member.sprite && (
            <Image
              src={member.sprite}
              alt={member.formLabel}
              width={60}
              height={60}
              className="size-full object-contain p-1"
              loading="eager"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            {href ? (
              <Link href={href} className="min-w-0 active:opacity-70">
                {Heading}
                <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-muted">
                  Scout →
                </span>
              </Link>
            ) : (
              <span className="min-w-0">{Heading}</span>
            )}
            {member.usagePct != null && member.usagePct >= 0.1 && (
              <div className="shrink-0 text-right leading-none">
                <div className="font-mono text-base font-bold tabular-nums">
                  {formatPickRate(member.usagePct)}
                </div>
                <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted">pick</div>
              </div>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {member.types.map((t) => (
              <TypeBadge key={t} type={t} size="sm" />
            ))}
          </div>
        </div>
      </div>

      {/* Item · Ability · Nature · Stat Points */}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-muted">Item</dt>
        <dd className="font-medium">{member.item ?? "—"}</dd>
        <dt className="text-muted">Ability</dt>
        <dd className="font-medium">{member.ability ?? "—"}</dd>
        <dt className="text-muted">Nature</dt>
        <dd className="font-medium">
          {member.nature ?? "—"}
          {member.nature &&
            (() => {
              const eff = natureEffect(member.nature);
              return eff ? (
                <span className="ml-1.5 text-muted">
                  (+{eff.up} −{eff.down})
                </span>
              ) : null;
            })()}
        </dd>
        {member.evStr && (
          <>
            {/* Its own row, in the game's own unit — no longer an unlabeled
                number string hanging off the Nature line. */}
            <dt className="text-muted">Stat Pts</dt>
            <dd className="font-mono text-[11px] font-medium tabular-nums">
              {member.evStr}
            </dd>
          </>
        )}
      </dl>

      {/* Moves — type-dotted, the same grammar as the Threat Profile's
          likely-set rows, so team coverage reads at a glance. */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {member.moves.map((mv) => {
          const t = moveTypes?.[mv];
          return (
            <span
              key={mv}
              className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-[11px] font-medium ring-1 ring-inset ring-white/5"
            >
              {t && (
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: TYPE_COLORS[t] }}
                  aria-hidden
                />
              )}
              {mv}
            </span>
          );
        })}
      </div>
    </div>
  );
}
