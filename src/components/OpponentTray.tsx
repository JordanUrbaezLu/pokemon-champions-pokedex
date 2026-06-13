"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefingSheet } from "./BriefingSheet";
import { useOpponents } from "@/lib/opponents";
import { TYPE_COLORS } from "@/lib/type-meta";

/**
 * The opponent dock: their team, pinned at preview, one tap away for the
 * whole battle — the cure for re-typing the same names into search every
 * turn. Renders nothing until something is pinned and nothing on the server,
 * so static pages are untouched. The chip for the page you're on is ringed.
 */
export function OpponentTray() {
  const { opponents, unpin, clear } = useOpponents();
  const [briefing, setBriefing] = useState(false);
  const pathname = usePathname();

  if (opponents.length === 0) return null;

  return (
    <>
      <nav
        aria-label="Pinned opponents"
        className="sticky bottom-0 z-30 border-t border-border bg-background/95 px-3 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur animate-[slideUp_.22s_ease-out]"
      >
        <div className="flex items-center gap-1.5">
          <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {opponents.map((m) => {
              const here = pathname === `/pokemon/${m.slug}`;
              return (
                <Link
                  key={m.slug}
                  href={`/pokemon/${m.slug}${m.formKey ? `?form=${m.formKey}` : ""}`}
                  aria-label={m.displayName}
                  aria-current={here ? "page" : undefined}
                  className="relative shrink-0 rounded-xl p-0.5 transition-opacity active:opacity-70 animate-[chipIn_.26s_ease-out]"
                  style={{
                    background: `radial-gradient(circle at 50% 40%, ${TYPE_COLORS[m.types[0]]}40, ${TYPE_COLORS[m.types[0]]}12)`,
                    boxShadow: here
                      ? `inset 0 0 0 2px ${TYPE_COLORS[m.types[0]]}`
                      : `inset 0 0 0 1.5px ${TYPE_COLORS[m.types[0]]}55`,
                  }}
                >
                  {m.icon ? (
                    <Image
                      src={m.icon}
                      alt=""
                      width={40}
                      height={40}
                      className="size-10 object-contain"
                      // Few, always visible — load now, no lazy pop-in.
                      loading="eager"
                      unoptimized
                    />
                  ) : (
                    <span className="flex size-10 items-center justify-center text-[10px] font-bold">
                      {m.displayName.slice(0, 3)}
                    </span>
                  )}
                  {m.quad && (
                    <span
                      className="absolute -right-0.5 -top-0.5 rounded-full px-1 text-[10px] font-black leading-3.5 text-white"
                      style={{ backgroundColor: TYPE_COLORS[m.quad] }}
                      title={`4× weak to ${m.quad}`}
                    >
                      4×
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setBriefing(true)}
            className="shrink-0 rounded-full border-2 border-accent px-3 py-1.5 text-xs font-black uppercase tracking-wide text-accent active:bg-accent/15"
          >
            Brief
          </button>
        </div>
      </nav>

      {briefing && (
        <BriefingSheet
          opponents={opponents}
          onRemove={unpin}
          onClear={() => {
            clear();
            setBriefing(false);
          }}
          onClose={() => setBriefing(false)}
        />
      )}
    </>
  );
}
