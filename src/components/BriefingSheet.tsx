"use client";

import { useEffect, useId, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { TypeBadge } from "./TypeBadge";
import { defensiveMultiplier } from "@/lib/type-chart";
import { TYPE_COLORS } from "@/lib/type-meta";
import { POKEMON_TYPES, type PokemonType } from "@/lib/types";
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
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  // Which attacking types hit the most of their team for 2×+; quads weighted.
  const bestTypes = POKEMON_TYPES.map((atk) => {
    const hit = opponents.filter((m) => defensiveMultiplier(atk, m.types) >= 2).length;
    const quads = opponents.filter((m) => defensiveMultiplier(atk, m.types) >= 4).length;
    return { atk, hit, score: hit + quads };
  })
    .filter((x) => x.hit >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const bySpeed = [...opponents]
    .filter((m) => m.speed != null)
    .sort((a, b) => (b.speed ?? 0) - (a.speed ?? 0));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal
      aria-labelledby={titleId}
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 max-h-[88dvh] w-full max-w-md animate-[slideUp_.18s_ease-out] overflow-y-auto rounded-t-3xl border-t border-border bg-surface p-5 pb-9">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
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
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted active:bg-border"
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
                href={`/pokemon/${m.slug}${m.formKey ? `?form=${m.formKey}` : ""}`}
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
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-bold">
                      {m.displayName}
                    </span>
                    {m.archetype[0] && (
                      <span
                        className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold"
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
                  <span
                    className="shrink-0 rounded px-1 font-mono text-[10px] font-black leading-4 text-white"
                    style={{ backgroundColor: TYPE_COLORS[m.quad] }}
                    title={`4× weak to ${m.quad}`}
                  >
                    4×
                  </span>
                )}
              </Link>
              <button
                type="button"
                onClick={() => onRemove(m.slug)}
                aria-label={`Remove ${m.displayName}`}
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-[10px] text-muted active:bg-border"
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
              {bestTypes.map(({ atk, hit }) => (
                <span key={atk} className="flex items-center gap-1.5">
                  <TypeBadge type={atk as PokemonType} size="md" />
                  <span className="text-xs font-semibold text-muted">
                    hits {hit} of {opponents.length}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
