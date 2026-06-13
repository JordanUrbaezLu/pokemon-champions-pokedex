"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { TypeBadge } from "./TypeBadge";
import { MegaIcon } from "./MegaIcon";
import { dexNumber, formatPickRate } from "@/lib/format";
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
      // `isolate` keeps the Mega badge's z-index contained to this card so it
      // can't paint over the sticky search bar while scrolling.
      className="glass-quiet relative isolate flex items-center gap-2.5 overflow-hidden rounded-2xl py-2 pl-1 pr-2 transition-colors active:bg-surface-2"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      {/* Whole-card tap target → base form. Stretched behind the content so the
          Mega badge, pin, etc. can sit above it without nesting. */}
      <Link
        href={`/pokemon/${entry.name}`}
        aria-label={entry.displayName}
        className="absolute inset-0 z-0"
      />

      {/* Pick-rate rank — stays with the Pokémon even while the list is
          filtered, so "is this a top threat?" reads at a glance. */}
      <div className="w-6 shrink-0 text-center">
        {rank != null ? (
          <span className="font-mono text-base font-black tabular-nums text-muted">
            {rank}
          </span>
        ) : (
          <span className="text-muted/40">·</span>
        )}
      </div>

      <div
        className="flex size-16 shrink-0 items-center justify-center rounded-xl"
        style={{
          background: `radial-gradient(circle at 50% 35%, ${accent}33, ${accent}0d)`,
        }}
      >
        {entry.icon ? (
          <Image
            src={entry.icon}
            alt=""
            width={64}
            height={64}
            className="size-16 object-contain"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <span className="font-mono text-xs text-muted">
          {dexNumber(entry.id)}
        </span>
        <p className="truncate text-[17px] font-bold leading-tight">
          {entry.displayName}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {entry.types.map((t) => (
            <TypeBadge key={t} type={t} size="sm" />
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 pr-0.5">
        {entry.hasMega && entry.megaKey && (
          <Link
            href={`/pokemon/${entry.name}?form=${entry.megaKey}`}
            aria-label={`${entry.displayName} Mega Evolution`}
            className="relative z-10 rounded-full p-1 active:bg-surface-2"
          >
            {/* The white glow is a PAINTED radial halo behind the badge, not a
                drop-shadow filter. iOS Safari composites a filtered element
                onto its own GPU layer and clips the filter to that layer's
                rectangular raster bounds, boxing the glow until a repaint (the
                "boxed aura, fixes on tap" bug). A background gradient has no
                such layer, so it can never box. The coin fills its box, so the
                bright ring is tuned to sit just OUTSIDE the coin's edge. */}
            <span className="relative grid size-7.5 place-items-center">
              <span
                aria-hidden
                className="pointer-events-none absolute size-12 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle, rgba(255,255,255,0) 58%, rgba(255,255,255,0.95) 72%, rgba(255,255,255,0.45) 84%, rgba(255,255,255,0) 97%)",
                }}
              />
              <MegaIcon className="relative size-7.5" />
            </span>
          </Link>
        )}
        {showUsage && (
          <div className="text-right">
            <div className="font-mono text-[15px] font-bold tabular-nums">
              {formatPickRate(usagePct!)}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted">
              pick
            </div>
          </div>
        )}
        {/* Pin as opponent — same store the detail page and tray use. */}
        <button
          type="button"
          onClick={togglePin}
          aria-pressed={isPinned}
          aria-label={isPinned ? `Unpin ${entry.displayName}` : `Pin ${entry.displayName} as opponent`}
          className={`relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border text-sm transition-colors ${
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
