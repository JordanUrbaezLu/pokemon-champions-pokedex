import type { PokemonAbility } from "@/lib/types";

const stripId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Abilities with their effect text, annotated with how often each is run on the
 * Champions doubles ladder. The meta-standard pick is highlighted — knowing the
 * opponent is almost certainly on, say, Intimidate changes the turn.
 *
 * (In Champions every Pokémon can run any of its abilities, so the "hidden"
 * distinction is irrelevant and intentionally not shown.)
 */
export function AbilityList({
  abilities,
  usage,
}: {
  abilities: PokemonAbility[];
  usage?: Record<string, number>;
}) {
  // The meta-standard ability = the highest-usage one among these.
  let topId = "";
  if (usage) {
    let max = -1;
    for (const a of abilities) {
      const u = usage[stripId(a.name)] ?? -1;
      if (u > max) {
        max = u;
        topId = stripId(a.name);
      }
    }
  }

  // Most-used first.
  const ordered = [...abilities].sort(
    (a, b) =>
      (usage?.[stripId(b.name)] ?? -1) - (usage?.[stripId(a.name)] ?? -1),
  );

  return (
    <ul className="flex flex-col gap-2">
      {ordered.map((ability) => {
        const pct = usage?.[stripId(ability.name)];
        const isTop = stripId(ability.name) === topId && pct != null;
        return (
          <li
            key={ability.name}
            className={`rounded-xl border bg-surface px-3 py-2.5 ${
              isTop ? "border-accent/50" : "border-border"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-bold">{ability.displayName}</span>
              {isTop && (
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
                  Most used
                </span>
              )}
              {pct != null && (
                <span
                  className={`ml-auto shrink-0 font-mono text-sm font-bold tabular-nums ${
                    isTop ? "text-accent" : "text-muted"
                  }`}
                >
                  {pct}%
                </span>
              )}
            </div>
            {ability.shortEffect && (
              <p className="mt-0.5 text-sm leading-snug text-muted">
                {ability.shortEffect}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
