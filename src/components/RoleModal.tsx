"use client";

import { useId } from "react";
import { Sheet } from "./Sheet";
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
  const color = ROLE_TONE[role.tone];

  return (
    <Sheet onClose={onClose} labelledBy={titleId}>
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
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted active:bg-border"
        >
          ✕
        </button>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-muted">{role.desc}</p>
    </Sheet>
  );
}
