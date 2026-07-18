"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Shared bottom-sheet shell for every tap-to-open detail sheet (moves, items,
 * the team briefing). Two things make it behave the same in the browser and in
 * the installed PWA — which the old per-modal markup did NOT:
 *
 *  1. It's PORTALED to <body>. A bottom sheet is `position: fixed`, so it must
 *     be positioned against the viewport — but rendered inline it's at the mercy
 *     of where it sits in the tree. That's why the MOVE sheet (rendered deep in
 *     the moves list) failed to appear in standalone iOS while the ITEM sheet
 *     (rendered shallow on the page) merely covered the footer. Portaling makes
 *     the trigger's DOM depth irrelevant.
 *  2. It rests ABOVE the opponent tray via `--tray-height` (published by
 *     OpponentTray), so the footer is ALWAYS visible and the sheet never covers
 *     it. When no tray is shown the var is 0 and the sheet bottoms out normally.
 *
 * Scroll is locked on the real scroller with scrollbar-width compensation, and
 * focus moves in with `preventScroll`, so opening a sheet never shifts or jumps
 * the page behind it (the old `body.overflow` toggle + un-guarded focus did).
 */
export function Sheet({
  onClose,
  labelledBy,
  children,
}: {
  onClose: () => void;
  /** id of the heading inside `children`, for aria-labelledby. */
  labelledBy: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // NB: no `overflow: hidden` scroll lock here. Locking the scroll root kills
    // the opponent tray's `position: sticky`, dropping the footer off-screen —
    // exactly what we must not do. Background scroll is instead contained by the
    // scrim (`touch-none`) and the panel (`overscroll-contain`), which needs no
    // overflow change and so never shifts the page or hides the footer.
    //
    // Focus moves into the dialog WITHOUT scrolling to it (that scroll-into-view
    // was the "jumps to the bottom of the page" symptom).
    panelRef.current?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  // Sheets only ever mount from a client interaction, so document is present;
  // the guard just keeps a stray server render from touching createPortal.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-end justify-center"
      // Stop at the top of the opponent tray so the footer is never covered.
      style={{ bottom: "var(--tray-height, 0px)" }}
      role="dialog"
      aria-modal
      aria-labelledby={labelledBy}
    >
      <div className="absolute inset-0 touch-none bg-black/60" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 max-h-full w-full max-w-md animate-[slideUp_.18s_ease-out] overflow-y-auto overscroll-contain rounded-t-3xl border-t border-border bg-surface p-5 pb-9 outline-none"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
