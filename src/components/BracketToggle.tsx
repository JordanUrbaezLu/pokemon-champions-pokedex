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
  const activeIndex = OPTIONS.findIndex((o) => o.key === bracket);
  return (
    <div
      role="group"
      aria-label="Ladder data bracket"
      className={`relative isolate inline-flex shrink-0 rounded-full border border-border bg-surface-2 p-0.5 ${className}`}
    >
      {/* Sliding accent thumb — each segment is equal width, so translating by
          its own width (100%) lands it exactly on the next option. */}
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 -z-10 w-[calc(50%-2px)] rounded-full bg-accent transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => setBracket(o.key)}
          aria-pressed={bracket === o.key}
          className={`flex-1 basis-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors duration-200 ${
            bracket === o.key ? "text-white" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
