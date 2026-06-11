"use client";

import { useBracket } from "@/lib/bracket";
import type { DataBracket } from "@/lib/types";

const OPTIONS: { key: DataBracket; label: string }[] = [
  { key: "master", label: "Master+" },
  { key: "all", label: "All ranks" },
];

/**
 * The data-source switch: Master+ (top ladder brackets, the default) vs the
 * whole ladder. One control, app-wide effect — pick rates, sort order, likely
 * sets, spreads and threat profiles all follow it.
 */
export function BracketToggle({ className = "" }: { className?: string }) {
  const [bracket, setBracket] = useBracket();
  return (
    <div
      role="group"
      aria-label="Ladder data bracket"
      className={`flex shrink-0 rounded-full border border-border bg-surface-2 p-0.5 ${className}`}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => setBracket(o.key)}
          aria-pressed={bracket === o.key}
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition-colors ${
            bracket === o.key ? "bg-accent text-white" : "text-muted active:bg-surface"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
