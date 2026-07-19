"use client";

import { useMemo, useState } from "react";
import { TypeBadge } from "./TypeBadge";
import { CategoryPill, MoveModal } from "./MoveModal";
import { spreadTag } from "@/lib/battle";
import type { DamageClass, MoveBenchmark, MoveSummary } from "@/lib/types";

type Filter = "all" | "used" | DamageClass | "priority";

function PriorityTag({ priority }: { priority: number }) {
  const positive = priority > 0;
  return (
    <span
      className={`shrink-0 rounded px-1 text-[10px] font-bold tabular-nums ${
        positive ? "bg-accent/20 text-accent" : "bg-surface-2 text-muted"
      }`}
    >
      {positive ? `+${priority}` : priority} prio
    </span>
  );
}

function SpreadTag({ target }: { target: string | null }) {
  const tag = spreadTag(target);
  if (!tag) return null;
  // "Spread" also hits your ally (a risk) → amber; "Both foes" is just sky.
  const amber = tag === "Spread";
  return (
    <span
      className={`shrink-0 rounded px-1.5 text-[10px] font-bold ${
        amber ? "bg-amber-500/20 text-amber-200" : "bg-sky-500/20 text-sky-300"
      }`}
    >
      {tag}
    </span>
  );
}

/** Two-line move row: full-width name on top so nothing is cut off, stats below. */
function MoveRow({
  move,
  usagePct,
  onOpen,
}: {
  move: MoveSummary;
  usagePct?: number;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-1.5 rounded-lg bg-surface px-2.5 py-2 text-left active:bg-surface-2"
      >
        <div className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {move.displayName}
          </span>
          {usagePct != null && (
            <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-accent">
              {usagePct}%
            </span>
          )}
          <span className="shrink-0 text-muted" aria-hidden>›</span>
        </div>
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
          <TypeBadge type={move.type} size="sm" />
          <CategoryPill cls={move.damageClass} />
          <SpreadTag target={move.target} />
          <span className="font-mono text-[11px] text-muted">
            Pwr {move.power ?? "—"}
          </span>
          <span className="font-mono text-[11px] text-muted">
            Acc {move.accuracy ?? "—"}
          </span>
          {move.priority !== 0 && <PriorityTag priority={move.priority} />}
        </div>
      </button>
    </li>
  );
}

/**
 * Moves. The **Likely set** (top moves by ladder usage) is shown up top — the
 * core mid-battle "what will it click?" read — with the full Champions movepool
 * one tap below (filterable, searchable). Tap any move for full details.
 */
export function MovesSection({
  moves,
  usage,
  benchmarks,
}: {
  moves: MoveSummary[];
  usage?: Record<string, number>;
  benchmarks?: MoveBenchmark[];
}) {
  const hasUsage = !!usage && Object.keys(usage).length > 0;
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MoveSummary | null>(null);

  const likely = useMemo(() => {
    if (!hasUsage) return [];
    return [...moves]
      .filter((m) => usage![m.name] != null)
      .sort((a, b) => (usage![b.name] ?? 0) - (usage![a.name] ?? 0))
      .slice(0, 6);
  }, [moves, usage, hasUsage]);

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    ...(hasUsage ? [{ key: "used" as Filter, label: "Common" }] : []),
    { key: "priority", label: "Priority" },
    { key: "physical", label: "Physical" },
    { key: "special", label: "Special" },
    { key: "status", label: "Status" },
  ];

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesFilter = (m: MoveSummary) => {
      if (filter === "all") return true;
      if (filter === "used") return usage?.[m.name] != null;
      if (filter === "priority") return m.priority !== 0;
      return m.damageClass === filter;
    };
    return [...moves]
      .filter(matchesFilter)
      // Prefix match: typing "a" shows only moves starting with "a".
      .filter((m) => !q || m.displayName.toLowerCase().startsWith(q))
      .sort((a, b) => {
        if (filter === "used") {
          return (usage?.[b.name] ?? 0) - (usage?.[a.name] ?? 0);
        }
        const aStatus = a.damageClass === "status" ? 1 : 0;
        const bStatus = b.damageClass === "status" ? 1 : 0;
        if (aStatus !== bStatus) return aStatus - bStatus;
        const ap = a.power ?? -1;
        const bp = b.power ?? -1;
        if (ap !== bp) return bp - ap;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [moves, usage, filter, query]);

  return (
    <section className="rounded-2xl glass-quiet p-3.5">
      <h2 className="hud-label text-[11px]">
        Moves <span className="text-foreground">· {moves.length}</span>
      </h2>

      {likely.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-accent">
            Likely set
          </p>
          <ul className="flex flex-col gap-1.5">
            {likely.map((m) => (
              <MoveRow
                key={m.name}
                move={m}
                usagePct={usage?.[m.name]}
                onOpen={() => setSelected(m)}
              />
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-surface-2 py-2 text-xs font-bold text-muted active:bg-border"
      >
        {open ? "Hide" : "Show all"} {moves.length} moves
        <span className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
          ›
        </span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="no-scrollbar -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                  filter === f.key ? "bg-accent text-white" : "bg-surface-2 text-muted"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <input
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a move…"
            aria-label="Search moves"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
          />

          {visible.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No moves match.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {visible.map((m) => (
                <MoveRow
                  key={m.name}
                  move={m}
                  usagePct={usage?.[m.name]}
                  onOpen={() => setSelected(m)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {selected && (
        <MoveModal
          move={selected}
          benchmark={benchmarks?.find((b) => b.move === selected.name)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
