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
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const overlay = overlayRef.current;
    const root = document.documentElement;

    // Move focus into the dialog WITHOUT scrolling to it (that scroll-into-view
    // was the "jumps to the bottom of the page" symptom). NB: no `overflow:hidden`
    // scroll lock — it kills the tray's `position: sticky` and drops the footer
    // off-screen; background scroll is contained below instead.
    panel?.focus({ preventScroll: true });

    // Flag a sheet open so the opponent tray goes inert (globals.css). Its
    // controls stay visible below the scrim, so without this a tap on Brief would
    // stack a second sheet. A counter tolerates a (rare) nested sheet.
    root.dataset.sheetOpen = String(Number(root.dataset.sheetOpen ?? "0") + 1);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Trap Tab inside the panel — `aria-modal` promises the background is
      // inert, so focus must not reach the page/tray behind the scrim.
      if (e.key === "Tab" && panel) {
        const focusables = panel.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) {
          e.preventDefault();
          panel.focus({ preventScroll: true });
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const activeEl = document.activeElement;
        if (e.shiftKey && (activeEl === first || activeEl === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);

    // Contain background scroll without an overflow lock: swallow wheel / touch
    // scrolling that isn't inside the scrollable panel. Native + non-passive so
    // preventDefault applies (React's synthetic wheel/touch handlers are passive).
    const blockOutside = (e: Event) => {
      if (e.target instanceof Node && panel?.contains(e.target)) return;
      e.preventDefault();
    };
    overlay?.addEventListener("wheel", blockOutside, { passive: false });
    overlay?.addEventListener("touchmove", blockOutside, { passive: false });

    return () => {
      window.removeEventListener("keydown", onKey);
      overlay?.removeEventListener("wheel", blockOutside);
      overlay?.removeEventListener("touchmove", blockOutside);
      const depth = Number(root.dataset.sheetOpen ?? "1") - 1;
      if (depth > 0) root.dataset.sheetOpen = String(depth);
      else delete root.dataset.sheetOpen;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  // Sheets only ever mount from a client interaction, so document is present;
  // the guard just keeps a stray server render from touching createPortal.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={overlayRef}
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
