"use client";

import { useId } from "react";
import Image from "next/image";
import Link from "next/link";
import { Sheet } from "./Sheet";
import { TypeBadge } from "./TypeBadge";
import { briefingBestTypes } from "@/lib/battle";
import { toDisplayName } from "@/lib/format";
import { TYPE_COLORS, typeTextColor } from "@/lib/type-meta";
import type { PinnedOpponent } from "@/lib/opponents";

/**
 * The team-preview brief: their six on one screen — each mon's archetype and
 * top threat, the speed order, and which attacking types hit the most of
 * their team. Aggregated purely from what was pinned; nothing extra ships.
 */
export function BriefingSheet({
  opponents,
  onRemove,
  onClear,
  onClose,
}: {
  opponents: PinnedOpponent[];
  onRemove: (slug: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const titleId = useId();

  // Which attacking types hit the most of their team for 2×+; quads weighted.
  // Ability-aware (battle.ts has the rule): a form whose every possible ability
  // blocks the type isn't counted; one that only MAY be immune is flagged.
  const bestTypes = briefingBestTypes(opponents);

  const bySpeed = [...opponents]
    .filter((m) => m.speed != null)
    .sort((a, b) => (b.speed ?? 0) - (a.speed ?? 0));

  return (
    <Sheet onClose={onClose} labelledBy={titleId}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={titleId} className="text-lg font-black leading-tight">
          Their team
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="rounded-full border border-accent/50 px-2.5 py-1 text-xs font-bold text-accent active:bg-accent/10"
          >
            New battle
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-target flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted active:bg-border"
          >
            ✕
          </button>
        </div>
      </div>

      {/* One row per pinned mon: identity, archetype, top threat, kill tag. */}
      <div className="mt-3 flex flex-col gap-1.5">
        {opponents.map((m) => (
          <div
            key={m.slug}
            className="flex items-center gap-2 rounded-xl bg-surface-2/60 py-1.5 pl-1.5 pr-2"
          >
            <Link
              href={`/pokemon/${m.slug}?form=${m.formKey ?? m.slug}`}
              onClick={onClose}
              className="flex min-w-0 flex-1 items-center gap-2 active:opacity-70"
            >
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: `radial-gradient(circle at 50% 40%, ${TYPE_COLORS[m.types[0]]}33, transparent)`,
                }}
              >
                {m.icon && (
                  <Image
                    src={m.icon}
                    alt=""
                    width={38}
                    height={38}
                    className="size-9.5 object-contain"
                    loading="eager"
                    unoptimized
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                {/* The name wins the width (the labelled 4× tag costs some):
                    "Mega Charizard Y" must never lose its Y to the archetype
                    chip — the chip truncates first. */}
                <span className="flex items-center gap-1.5">
                  <span className="max-w-full shrink-0 truncate text-[13px] font-bold">
                    {m.displayName}
                  </span>
                  {m.archetype[0] && (
                    <span
                      className="min-w-0 truncate rounded-full px-1.5 py-px text-[10px] font-bold"
                      style={{
                        backgroundColor: `${m.archetype[0].tone}22`,
                        color: m.archetype[0].tone,
                      }}
                    >
                      {m.archetype[0].label}
                    </span>
                  )}
                </span>
                {m.headline && (
                  <span className="block truncate text-[11px] text-muted">
                    {m.headline}
                  </span>
                )}
              </span>
              {m.quad && (
                // Names the type, not just its colour (colour-blind / low-
                // contrast reads): "4× Ground", text in the badge's own
                // legible ink (white on Electric yellow was unreadable).
                <span
                  className="shrink-0 rounded px-1 text-[10px] font-black leading-4"
                  style={{ backgroundColor: TYPE_COLORS[m.quad], color: typeTextColor(m.quad) }}
                  title={`4× weak to ${toDisplayName(m.quad)}`}
                >
                  <span className="font-mono">4×</span> {toDisplayName(m.quad)}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => onRemove(m.slug)}
              aria-label={`Remove ${m.displayName}`}
              className="tap-target flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-[10px] text-muted active:bg-border"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {bySpeed.length > 1 && (
        <div className="mt-4">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
            Speed order · common spreads, Lv. 50
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {bySpeed.map((m, i) => (
              <span key={m.slug} className="flex items-center gap-1">
                {i > 0 && (
                  <span className="text-muted" aria-hidden>
                    ›
                  </span>
                )}
                <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">
                  <span className="max-w-20 truncate">{m.displayName}</span>
                  <span className="font-mono text-[11px] font-bold tabular-nums text-sky-300">
                    {m.speed}
                  </span>
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {bestTypes.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
            Best types into their team
          </p>
          <div className="flex flex-wrap gap-2">
            {bestTypes.map(({ atk, hit, mayBeImmune }) => (
              <span key={atk} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <TypeBadge type={atk} size="md" />
                <span className="text-xs font-semibold text-muted">
                  hits {hit} of {opponents.length}
                </span>
                {/* Counted, but an ability it may run blocks the type — the
                    same amber ⚠ caveat the Type Matchups panel uses. */}
                {mayBeImmune.length > 0 && (
                  <span className="text-[11px] font-semibold text-amber-300/90">
                    <span aria-hidden>⚠ </span>
                    {mayBeImmune.join(", ")} may be immune
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
