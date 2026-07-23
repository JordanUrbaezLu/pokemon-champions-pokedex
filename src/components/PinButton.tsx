"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The "pin as opponent" toggle, shared by the home list and the detail page so
 * the look and the pop-on-pin animation are guaranteed identical. Pops only
 * when pinning (not when unpinning); the animation lives on the button itself
 * and resets on animationend, so it re-fires on every pin without remounting.
 *
 * When the tray is full the button stays tappable: a tap surfaces a transient
 * "why not" note (a title tooltip never shows on touch), announced via
 * role="status" for screen readers too.
 */
export function PinButton({
  pinned,
  onToggle,
  pinLabel,
  unpinLabel,
  caption = false,
  full = false,
  className = "size-10 text-lg",
}: {
  pinned: boolean;
  onToggle: () => void;
  /** accessible label when not pinned, e.g. "Pin Garchomp as opponent" */
  pinLabel: string;
  /** accessible label when pinned */
  unpinLabel: string;
  /** show the "pin"/"foe" caption under the icon (detail hero) */
  caption?: boolean;
  /** the tray holds 6 — dim the control and explain on tap instead of pinning */
  full?: boolean;
  /** size + text-size utilities for the circle */
  className?: string;
}) {
  const [popping, setPopping] = useState(false);
  const [fullNote, setFullNote] = useState(false);
  const noteTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (noteTimer.current != null) window.clearTimeout(noteTimer.current);
    },
    [],
  );

  const blocked = full && !pinned;
  return (
    <button
      type="button"
      onClick={() => {
        if (blocked) {
          setFullNote(true);
          if (noteTimer.current != null) window.clearTimeout(noteTimer.current);
          noteTimer.current = window.setTimeout(() => setFullNote(false), 1600);
          return;
        }
        if (!pinned) setPopping(true); // celebrate the pin, stay quiet on unpin
        onToggle();
      }}
      onAnimationEnd={() => setPopping(false)}
      aria-pressed={pinned}
      aria-disabled={blocked || undefined}
      aria-label={pinned ? unpinLabel : pinLabel}
      title={blocked ? "Opponent tray full (6)" : undefined}
      className={`relative z-10 flex shrink-0 flex-col items-center justify-center rounded-full border transition-colors ${
        popping ? "animate-[popPin_.36s_ease-out]" : ""
      } ${
        pinned
          ? "border-accent bg-accent/15 text-accent"
          : blocked
            ? // Dimmed via border/text alpha, NOT opacity on the button — the
              // tray-full note renders inside and must stay fully legible.
              "border-border/40 bg-surface/40 text-muted/40"
            : "border-border bg-surface/60 text-muted active:bg-surface-2"
      } ${className}`}
    >
      {/* Announced immediately; visible for a beat so the tap explains itself. */}
      <span role="status" className="contents">
        {fullNote && (
          <span className="absolute -top-8 right-0 z-20 whitespace-nowrap rounded-md bg-surface-2 px-2 py-1 text-[10px] font-bold normal-case tracking-normal text-foreground shadow-lg ring-1 ring-inset ring-white/10 animate-[fadeIn_.15s_ease-out]">
            Tray full · unpin one first
          </span>
        )}
      </span>
      <span className="leading-none" aria-hidden>
        {pinned ? "✓" : "＋"}
      </span>
      {caption && (
        <span className="mt-0.5 text-[10px] font-bold uppercase leading-none tracking-tight">
          {pinned ? "foe" : "pin"}
        </span>
      )}
    </button>
  );
}
