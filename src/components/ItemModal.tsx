"use client";

import { useId } from "react";
import Image from "next/image";
import { Sheet } from "./Sheet";
import type { ItemDetail } from "@/lib/types";

/** Bottom-sheet modal with a held item's complete details. */
export function ItemModal({
  item,
  usagePct,
  onClose,
}: {
  item: ItemDetail;
  usagePct?: number;
  onClose: () => void;
}) {
  const titleId = useId();

  return (
    <Sheet onClose={onClose} labelledBy={titleId}>
      <div className="flex items-start gap-3">
        {item.sprite && (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-2">
            <Image
              src={item.sprite}
              alt=""
              width={40}
              height={40}
              className="size-10 [image-rendering:pixelated]"
              unoptimized
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-xl font-black leading-tight">
            {item.displayName}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            {item.category && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-muted">
                {item.category}
              </span>
            )}
            {usagePct != null && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 font-bold text-accent">
                {usagePct}% of sets
              </span>
            )}
          </div>
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

      <p className="mt-4 text-sm leading-relaxed text-muted">
        {item.effect || item.shortEffect || "No description available."}
      </p>

      {item.flingPower != null && (
        <p className="mt-3 text-xs text-muted">
          Fling power: <span className="font-mono">{item.flingPower}</span>
        </p>
      )}
    </Sheet>
  );
}
