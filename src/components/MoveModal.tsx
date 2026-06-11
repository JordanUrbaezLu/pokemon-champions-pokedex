"use client";

import { useEffect, useId, useRef } from "react";
import { TypeBadge } from "./TypeBadge";
import { prettySmogonName, toDisplayName } from "@/lib/format";
import type { DamageClass, MoveBenchmark, MoveSummary } from "@/lib/types";

const CATEGORY: Record<DamageClass, { label: string; color: string }> = {
  physical: { label: "Physical", color: "#e0683b" },
  special: { label: "Special", color: "#4f86d6" },
  status: { label: "Status", color: "#8a93a0" },
};

/** Damage-class pill, shared by the move list and the move modal. */
export function CategoryPill({ cls, big = false }: { cls: DamageClass; big?: boolean }) {
  const { label, color } = CATEGORY[cls];
  return (
    <span
      className={`shrink-0 rounded font-bold uppercase tracking-wide ${
        big ? "px-2 py-0.5 text-xs" : "px-1.5 py-0.5 text-[10px]"
      }`}
      style={{ backgroundColor: `${color}26`, color }}
    >
      {big ? label : label.slice(0, 4)}
    </span>
  );
}

function ModalStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-surface-2 py-2">
      <div className="font-mono text-base font-bold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

const TARGET_LABELS: Record<string, string> = {
  "selected-pokemon": "Hits one target",
  "selected-pokemon-me-first": "Hits one target",
  "all-opponents": "Hits both foes",
  "all-other-pokemon": "Hits all others",
  "all-pokemon": "Hits everyone",
  user: "Affects the user",
  "users-field": "Your side of the field",
  "user-and-allies": "User and allies",
  "user-or-ally": "User or an ally",
  ally: "An ally",
  "random-opponent": "Hits a random foe",
  "entire-field": "The whole field",
  "opponents-field": "The foes' side",
  "all-allies": "Your allies",
  "specific-move": "Depends on the move used",
};
const STAT_SHORT: Record<string, string> = {
  attack: "Atk",
  defense: "Def",
  "special-attack": "SpA",
  "special-defense": "SpD",
  speed: "Spe",
  accuracy: "Acc",
  evasion: "Eva",
};

/** Concise battle facts derived from the move's mechanics. */
function moveFacts(move: MoveSummary): string[] {
  const facts: string[] = [];
  // A secondary stat change (e.g. Crunch's 20% to drop Defense) carries a
  // chance; a self-boost (Swords Dance) is guaranteed (statChance 0).
  const chancePrefix =
    move.statChance > 0 && move.statChance < 100 ? `${move.statChance}% ` : "";
  for (const sc of move.statChanges) {
    const sign = sc.change > 0 ? "+" : "";
    facts.push(
      `${chancePrefix}${sign}${sc.change} ${STAT_SHORT[sc.stat] ?? toDisplayName(sc.stat)}`,
    );
  }
  if (move.ailment) {
    facts.push(
      `${move.ailmentChance > 0 ? `${move.ailmentChance}% ` : ""}${toDisplayName(move.ailment)}`,
    );
  }
  if (move.flinchChance > 0) facts.push(`${move.flinchChance}% flinch`);
  if (move.drain > 0) facts.push(`Drains ${move.drain}%`);
  if (move.drain < 0) facts.push(`${-move.drain}% recoil`);
  if (move.healing > 0) facts.push(`Heals ${move.healing}% HP`);
  if (move.critRate > 0) facts.push("High crit rate");
  if (move.maxHits && move.maxHits > 1) {
    facts.push(
      move.minHits === move.maxHits
        ? `Hits ${move.maxHits}×`
        : `Hits ${move.minHits}–${move.maxHits}×`,
    );
  }
  return facts;
}

/** Bottom-sheet modal with a move's complete details. */
export function MoveModal({
  move,
  benchmark,
  onClose,
}: {
  move: MoveSummary;
  /** precomputed KO verdicts vs the top meta, when this mon's set runs it */
  benchmark?: MoveBenchmark | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

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

  const facts = moveFacts(move);
  const target = move.target
    ? TARGET_LABELS[move.target] ?? toDisplayName(move.target)
    : null;

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
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id={titleId} className="text-xl font-black leading-tight">
              {move.displayName}
            </h3>
            <div className="mt-2 flex items-center gap-2">
              <TypeBadge type={move.type} />
              <CategoryPill cls={move.damageClass} big />
            </div>
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

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <ModalStat label="Power" value={move.power ?? "—"} />
          <ModalStat label="Acc" value={move.accuracy ?? "—"} />
          <ModalStat label="Prio" value={move.priority > 0 ? `+${move.priority}` : move.priority} />
        </div>

        {target && <p className="mt-3 text-sm text-muted">{target}.</p>}

        {benchmark && (benchmark.ohkoCount > 0 || benchmark.twoCount > 0) && (
          <div className="mt-3 rounded-xl bg-surface-2/70 p-2.5">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
              Off its common set, vs the top meta
            </p>
            <div className="flex flex-col gap-1 text-xs">
              {benchmark.ohkoCount > 0 && (
                <p>
                  <span className="font-black text-accent">OHKO</span>{" "}
                  <span className="font-semibold">
                    {benchmark.ohko.map(prettySmogonName).join(", ")}
                  </span>
                  {benchmark.ohkoCount > benchmark.ohko.length && (
                    <span className="text-muted">
                      {" "}
                      +{benchmark.ohkoCount - benchmark.ohko.length} more
                    </span>
                  )}
                </p>
              )}
              {benchmark.twoCount > 0 && (
                <p>
                  <span className="font-black text-amber-300">2HKO</span>{" "}
                  <span className="font-semibold">
                    {benchmark.two.map(prettySmogonName).join(", ")}
                  </span>
                  {benchmark.twoCount > benchmark.two.length && (
                    <span className="text-muted">
                      {" "}
                      +{benchmark.twoCount - benchmark.two.length} more
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
        )}

        {facts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {facts.map((f) => (
              <span
                key={f}
                className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold"
              >
                {f}
              </span>
            ))}
          </div>
        )}

        {(move.effect || move.shortEffect) && (
          <p className="mt-4 text-sm leading-relaxed text-muted">
            {move.effect || move.shortEffect}
          </p>
        )}
      </div>
    </div>
  );
}
