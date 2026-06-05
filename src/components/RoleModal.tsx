"use client";

import { useEffect, useId, useRef } from "react";
import { ROLE_TONE, type DoublesRole } from "@/lib/battle";

/** Bottom-sheet modal explaining a doubles role tag (Fake Out, Intimidate, …). */
export function RoleModal({
  role,
  onClose,
}: {
  role: DoublesRole;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const color = ROLE_TONE[role.tone];

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
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span
              id={titleId}
              className="rounded-full px-2.5 py-1 text-base font-black"
              style={{ backgroundColor: `${color}22`, color }}
            >
              {role.label}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              {role.kind}
            </span>
          </div>
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

        <p className="mt-4 text-sm leading-relaxed text-muted">{role.desc}</p>
      </div>
    </div>
  );
}
