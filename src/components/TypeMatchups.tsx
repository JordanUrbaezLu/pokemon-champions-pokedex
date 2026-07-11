import { TypeBadge } from "./TypeBadge";
import { defensiveProfile, abilityMatchupNotes } from "@/lib/type-chart";
import type { PokemonType } from "@/lib/types";

/**
 * The "what move do I click?" panel: the defender's weaknesses (4× called out
 * loudly), resistances, and immunities. Pure type math — renders identically
 * with or without ladder data, so it's always available mid-battle. When the
 * form has an ability that overrides type math (Levitate, Flash Fire, Thick
 * Fat…), a caveat calls it out so a "weakness" the ability negates never sends
 * a trainer into a dead click.
 */
export function TypeMatchups({
  types,
  abilities = [],
}: {
  types: PokemonType[];
  /** the form's possible abilities, by slug — for the matchup caveats */
  abilities?: readonly string[];
}) {
  const profile = defensiveProfile(types);
  const abilityNotes = abilityMatchupNotes(abilities);

  const allRows: {
    key: string;
    label: string;
    mult: string;
    types: PokemonType[];
    accent?: "quad" | "immune";
  }[] = [
    { key: "quad", label: "Weak", mult: "4×", types: profile.quad, accent: "quad" },
    { key: "weak", label: "Weak", mult: "2×", types: profile.weak },
    { key: "resist", label: "Resists", mult: "½×", types: profile.resists },
    { key: "resist2", label: "Resists", mult: "¼×", types: profile.doubleResists },
    { key: "immune", label: "Immune", mult: "0×", types: profile.immune, accent: "immune" },
  ];
  const rows = allRows.filter((r) => r.types.length > 0);

  return (
    <section className="rounded-2xl glass-quiet p-3.5">
      <h2 className="mb-2.5 text-xs font-black uppercase tracking-wider text-muted">
        Type Matchups
      </h2>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${
              row.accent === "quad"
                ? "border border-accent/50 bg-accent/10"
                : row.accent === "immune"
                  ? "bg-surface-2/70"
                  : "bg-surface"
            }`}
          >
            {/* Fixed-width label block: multiplier over the word, so long
                labels ("Resists") never collide with the badges at 375px. */}
            <span className="flex w-13 shrink-0 flex-col">
              <span
                className={`font-mono text-sm font-bold leading-tight tabular-nums ${
                  row.accent === "quad" ? "text-accent" : ""
                }`}
              >
                {row.mult}
              </span>
              <span
                className={`text-[10px] font-bold uppercase tracking-wide ${
                  row.accent === "quad" ? "text-accent/90" : "text-muted"
                }`}
              >
                {row.label}
              </span>
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1">
              {row.types.map((t) => (
                <TypeBadge key={t} type={t} size={row.accent === "quad" ? "md" : "sm"} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {abilityNotes.length > 0 && (
        <div className="mt-2.5 border-t border-border pt-2">
          <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-amber-300/90">
            Ability can change this
          </p>
          <ul className="flex flex-col gap-0.5">
            {abilityNotes.map((n) => (
              <li key={n} className="flex gap-1.5 text-[11px] leading-snug text-muted">
                <span aria-hidden className="text-amber-300/70">
                  ⚠
                </span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
