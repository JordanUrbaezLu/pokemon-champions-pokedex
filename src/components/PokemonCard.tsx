"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { TypeBadge } from "./TypeBadge";
import { MegaIcon } from "./MegaIcon";
import { formatPickRate } from "@/lib/format";
import { TYPE_COLORS } from "@/lib/type-meta";
import { defensiveProfile } from "@/lib/type-chart";
import { useOpponents } from "@/lib/opponents";
import type { RosterEntry } from "@/lib/pokedex";

/**
 * Warm the detail-page hero artwork once the card scrolls near the viewport, so
 * tapping it shows the image instantly — the image counterpart to Next's
 * route prefetch. Uses a wide rootMargin to fetch just ahead of the scroll.
 */
function useArtworkPrefetch(srcs: (string | null)[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const urls = srcs.filter((s): s is string => !!s);
    if (!el || urls.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          for (const url of urls) {
            const img = new window.Image();
            img.src = url;
          }
          io.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcs.join("|")]);
  return ref;
}

/**
 * A tappable roster row built for fast scanning: a type-colored accent + tinted
 * icon tile let a trainer recognize a Pokémon by color before reading the name.
 * The Mega mark and the active bracket's doubles pick rate sit together on the
 * right. Prefetch is left to Next's default scheduler, which warms the rows in
 * view.
 */
export function PokemonCard({
  entry,
  usagePct,
  rank,
}: {
  entry: RosterEntry;
  usagePct: number | null;
  /** Pick-rate rank across the whole roster (1 = most-used); null if no data. */
  rank: number | null;
}) {
  const accent = TYPE_COLORS[entry.types[0]];
  const showUsage = usagePct != null && usagePct >= 0.1;
  const cardRef = useArtworkPrefetch([entry.artwork, entry.megaArtwork]);

  const { opponents, pin, unpin } = useOpponents();
  const isPinned = opponents.some((o) => o.slug === entry.name);
  const togglePin = () => {
    if (isPinned) {
      unpin(entry.name);
      return;
    }
    // A quick base-form pin from the list — identity + its 4× kill shot. Open
    // the Pokémon to upgrade it to a Mega-specific pin (same slug replaces).
    pin({
      slug: entry.name,
      formKey: null,
      displayName: entry.displayName,
      icon: entry.icon,
      types: entry.types,
      quad: defensiveProfile(entry.types).quad[0] ?? null,
      speed: null,
      archetype: [],
      headline: null,
    });
  };

  return (
    <div
      ref={cardRef}
      // `isolate` contains the card's stacking context so nothing paints over
      // the sticky search bar while scrolling.
      className="glass-quiet relative isolate flex items-center gap-2.5 overflow-hidden rounded-2xl px-2.5 py-2 transition-colors active:bg-surface-2"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      {/* Whole-card tap target → base form. Stretched behind the content so the
          Mega badge and pin can sit above it without nesting. */}
      <Link
        href={`/pokemon/${entry.name}`}
        aria-label={entry.displayName}
        className="absolute inset-0 z-0"
      />

      <div
        className="flex size-18.5 shrink-0 items-center justify-center rounded-xl"
        style={{
          background: `radial-gradient(circle at 50% 35%, ${accent}33, ${accent}0d)`,
        }}
      >
        {entry.icon ? (
          <Image
            src={entry.icon}
            alt=""
            width={74}
            height={74}
            className="size-18.5 object-contain"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        {/* Pick-rate rank in place of the National Dex # — the number a trainer
            actually cares about. Holds through search filtering; top-3 glow
            accent. */}
        {rank != null ? (
          <span
            className={`font-mono text-xs font-bold tabular-nums ${
              rank <= 3 ? "text-accent" : "text-muted"
            }`}
          >
            #{rank}
          </span>
        ) : (
          <span className="font-mono text-xs text-muted/50">·</span>
        )}
        <p className="truncate text-[17px] font-bold leading-tight">
          {entry.displayName}
        </p>
        {/* nowrap: long dual types (Dragon/Ground) stay on one line. */}
        <div className="mt-1.5 flex gap-1 overflow-hidden">
          {entry.types.map((t) => (
            <TypeBadge key={t} type={t} size="sm" />
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {entry.hasMega && entry.megaKey && (
          <Link
            href={`/pokemon/${entry.name}?form=${entry.megaKey}`}
            aria-label={`${entry.displayName} Mega Evolution`}
            className="relative z-10 active:opacity-70"
          >
            {/* The white glow is a box-shadow on a coin-sized round disc behind
                the badge — same soft circular glow as the original drop-shadow,
                but box-shadow is NOT a composited filter layer, so iOS Safari's
                tight filter-raster bounds can never box it (the bug that clipped
                the old drop-shadow into a square). */}
            <span className="relative grid size-6 place-items-center">
              <span
                aria-hidden
                className="absolute size-5 rounded-full"
                style={{
                  boxShadow:
                    "0 0 4px 0 rgba(255,255,255,1), 0 0 8px 1px rgba(255,255,255,0.6)",
                }}
              />
              <MegaIcon className="relative size-6" />
            </span>
          </Link>
        )}
        {showUsage && (
          <div className="text-right font-mono text-sm font-bold tabular-nums">
            {formatPickRate(usagePct!)}
          </div>
        )}
        {/* Pin as opponent — same store the detail page and tray use. */}
        <button
          type="button"
          onClick={togglePin}
          aria-pressed={isPinned}
          aria-label={isPinned ? `Unpin ${entry.displayName}` : `Pin ${entry.displayName} as opponent`}
          className={`relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs transition-colors ${
            isPinned
              ? "border-accent bg-accent/15 text-accent"
              : "border-border bg-surface/60 text-muted active:bg-surface-2"
          }`}
        >
          <span aria-hidden>{isPinned ? "✓" : "＋"}</span>
        </button>
      </div>
    </div>
  );
}
