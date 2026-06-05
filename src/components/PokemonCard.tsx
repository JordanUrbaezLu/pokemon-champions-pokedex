"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { TypeBadge } from "./TypeBadge";
import { MegaIcon } from "./MegaIcon";
import { dexNumber, formatPickRate } from "@/lib/format";
import { TYPE_COLORS } from "@/lib/type-meta";
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
 * The Mega mark and doubles pick rate sit together on the right. Prefetch is
 * left to Next's default scheduler, which warms the rows in view.
 */
export function PokemonCard({ entry }: { entry: RosterEntry }) {
  const accent = TYPE_COLORS[entry.types[0]];
  const showUsage = entry.usagePct != null && entry.usagePct >= 0.1;
  const cardRef = useArtworkPrefetch([entry.artwork, entry.megaArtwork]);

  return (
    <div
      ref={cardRef}
      // `isolate` keeps the Mega badge's z-index contained to this card so it
      // can't paint over the sticky search bar while scrolling.
      className="relative isolate flex items-center gap-3 overflow-hidden rounded-2xl border border-border bg-surface px-2.5 py-2 transition-colors active:bg-surface-2"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      {/* Whole-card tap target → base form. Stretched behind the content so the
          Mega badge can link to its own Mega-toggled view without nesting. */}
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

      {/* Mega mark sits immediately left of the doubles pick rate. Tapping it
          jumps straight to the Mega-toggled detail view. */}
      <div className="flex shrink-0 items-center gap-2 pr-1">
        {entry.hasMega && entry.megaKey && (
          <Link
            href={`/pokemon/${entry.name}?form=${entry.megaKey}`}
            aria-label={`${entry.displayName} Mega Evolution`}
            className="relative z-10 -m-1 rounded-full p-1 active:bg-surface-2"
          >
            <MegaIcon className="size-7.5 filter-[drop-shadow(0_0_4px_rgba(255,255,255,1))_drop-shadow(0_0_8px_rgba(255,255,255,0.6))]" />
          </Link>
        )}
        {showUsage && (
          <div className="text-right">
            <div className="font-mono text-[15px] font-bold tabular-nums">
              {formatPickRate(entry.usagePct!)}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted">
              pick
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
