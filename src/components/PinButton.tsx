"use client";

import { useState } from "react";

/**
 * The "pin as opponent" toggle, shared by the home list and the detail page so
 * the look and the pop-on-pin animation are guaranteed identical. Pops only
 * when pinning (not when unpinning); the animation lives on the button itself
 * and resets on animationend, so it re-fires on every pin without remounting.
 */
export function PinButton({
  pinned,
  onToggle,
  pinLabel,
  unpinLabel,
  caption = false,
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
  /** size + text-size utilities for the circle */
  className?: string;
}) {
  const [popping, setPopping] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (!pinned) setPopping(true); // celebrate the pin, stay quiet on unpin
        onToggle();
      }}
      onAnimationEnd={() => setPopping(false)}
      aria-pressed={pinned}
      aria-label={pinned ? unpinLabel : pinLabel}
      className={`relative z-10 flex shrink-0 flex-col items-center justify-center rounded-full border transition-colors ${
        popping ? "animate-[popPin_.36s_ease-out]" : ""
      } ${
        pinned
          ? "border-accent bg-accent/15 text-accent"
          : "border-border bg-surface/60 text-muted active:bg-surface-2"
      } ${className}`}
    >
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
