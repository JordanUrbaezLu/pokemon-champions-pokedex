"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { TypeBadge } from "./TypeBadge";
import { MegaIcon } from "./MegaIcon";
import { PinButton } from "./PinButton";
import { formatPickRate } from "@/lib/format";
import { TYPE_COLORS } from "@/lib/type-meta";
import { useOpponents } from "@/lib/opponents";
import type { RosterEntry } from "@/lib/pokedex";

/**
 * Tracks when a card scrolls near the viewport — two jobs:
 *  - warm the detail-page hero artwork (the image counterpart to Next's route
 *    prefetch) so tapping the card shows it instantly;
 *  - flip `seen` so the row icon can switch from lazy to EAGER loading.
 *
 * Why `seen` matters: iOS Safari's native `loading="lazy"` does NOT reliably
 * (re)load/paint in-viewport images after a client-side back navigation until a
 * scroll nudges them — which left already-cached roster icons blurry/unrendered
 * on Back (the eager detail hero never had this problem). An IntersectionObserver
 * DOES fire on mount for elements already in view, so eager-loading once `seen`
 * repaints them immediately, while off-screen rows stay lazy (light first paint).
 * `seen` is sticky — once a row has been shown it never reverts.
 */
function useCardInView(prefetch: (string | null)[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return; // sticky — nothing left to observe
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          // Warm the detail hero artwork — but never on a metered / very slow
          // link. Prefetching full-res artwork for the whole roster as it
          // scrolls can burn 100+ MB of cellular data the trainer never asked
          // for; Save-Data and 2g connections opt out (the icon still repaints).
          const conn = (
            navigator as Navigator & {
              connection?: { saveData?: boolean; effectiveType?: string };
            }
          ).connection;
          const metered =
            !!conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? "");
          if (!metered) {
            for (const url of prefetch) {
              if (url) {
                const img = new window.Image();
                img.src = url;
              }
            }
          }
          io.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, prefetch.join("|")]);
  return { ref, seen };
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
  const { ref: cardRef, seen } = useCardInView([entry.artwork, entry.megaArtwork]);

  const { opponents, pin, unpin, isFull } = useOpponents();
  const isPinned = opponents.some((o) => o.slug === entry.name);
  const togglePin = () => {
    if (isPinned) unpin(entry.name);
    // Full pin payload (the most-played form's archetype / top threat / speed),
    // precomputed at build time — so the briefing reads the same as a pin made
    // on the detail page.
    else pin(entry.pin);
  };

  return (
    <div
      ref={cardRef}
      // `isolate` contains the card's stacking context so nothing paints over
      // the sticky search bar while scrolling. `content-visibility:auto` skips
      // layout/paint for off-screen rows (226 of them) to keep scroll smooth on
      // constrained hardware; contain-intrinsic-size reserves each row's height
      // so the scrollbar stays stable. (The Mega halo is the card's own
      // box-shadow, painted by the parent — not clipped by this containment.)
      className="glass-quiet relative isolate flex items-center gap-2.5 rounded-2xl px-2.5 py-2 transition-colors [contain-intrinsic-size:0_92px] [content-visibility:auto] active:bg-surface-2"
      style={{
        borderLeft: `3px solid ${accent}`,
        // Mega-capable Pokémon get a soft white halo around the whole card —
        // a second, card-level cue (beyond the inline Mega mark) that this one
        // has a Mega Evolution in play.
        ...(entry.hasMega && {
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.1), 0 0 0 1px rgba(255,255,255,0.56), 0 0 14px 0 rgba(255,255,255,0.63)",
        }),
      }}
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
            // Eager once the row is in view so iOS Safari repaints it on a back
            // navigation (native lazy leaves cached icons blurry until a scroll);
            // rows still off-screen stay lazy to keep first paint light.
            loading={seen ? "eager" : "lazy"}
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        {/* Pick-rate rank in place of the National Dex # — the number a trainer
            actually cares about. Holds through search filtering; top-3 glow
            accent. */}
        {rank != null ? (
          // A ranked mon can also be new to Champions — show BOTH, so a newcomer
          // that has already climbed the ladder still reads as unfamiliar (the
          // whole point of the badge) instead of looking like a veteran.
          <span className="flex items-center gap-1.5">
            <span
              className={`font-mono text-xs font-bold tabular-nums ${
                rank <= 3 ? "text-accent" : "text-muted"
              }`}
            >
              #{rank}
            </span>
            {entry.isNew && (
              <span className="rounded bg-sky-400/15 px-1 py-px text-[9px] font-black uppercase tracking-wide text-sky-300 ring-1 ring-inset ring-sky-400/30">
                New
              </span>
            )}
          </span>
        ) : entry.isNew ? (
          // Recently added to Champions, no ladder rank yet — flag it so trainers
          // notice the mon they haven't faced. Cyan, not red (red = threat only).
          <span className="rounded bg-sky-400/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-sky-300 ring-1 ring-inset ring-sky-400/30">
            New
          </span>
        ) : (
          <span className="font-mono text-xs text-muted/50">·</span>
        )}
        {/* Name with the Mega mark inline to its right — the glow flags "has a
            Mega" right where the eye already is. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 truncate text-[17px] font-bold leading-tight">
            {entry.displayName}
          </p>
          {entry.hasMega && entry.megaKey && (
            <Link
              href={`/pokemon/${entry.name}?form=${entry.megaKey}`}
              aria-label={`${entry.displayName} Mega Evolution`}
              className="relative z-10 shrink-0 active:opacity-70"
            >
              {/* White glow = box-shadow on a round disc behind the badge — the
                  soft circular glow of the original drop-shadow, but box-shadow
                  is NOT a composited filter, so iOS Safari's tight filter-raster
                  bounds can never box it (the bug that squared off the glow). */}
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
        </div>
        {/* nowrap: long dual types (Dragon/Ground) stay on one line. */}
        <div className="mt-1.5 flex gap-1 overflow-hidden">
          {entry.types.map((t) => (
            <TypeBadge key={t} type={t} size="sm" />
          ))}
        </div>
      </div>

      {/* Mega moved inline, so pick rate and pin get the room to grow. */}
      <div className="flex shrink-0 items-center gap-3 pr-0.5">
        {showUsage && (
          <div className="text-right leading-none">
            <div className="font-mono text-xl font-bold tabular-nums">
              {formatPickRate(usagePct!)}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">
              pick
            </div>
          </div>
        )}
        {/* Pin as opponent — shared component, same store/animation as detail. */}
        <PinButton
          pinned={isPinned}
          onToggle={togglePin}
          disabled={!isPinned && isFull}
          pinLabel={`Pin ${entry.displayName} as opponent`}
          unpinLabel={`Unpin ${entry.displayName}`}
          className="size-11 text-lg"
        />
      </div>
    </div>
  );
}
