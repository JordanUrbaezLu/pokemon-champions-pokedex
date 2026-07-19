import type { Metadata } from "next";
import Link from "next/link";
import { HomeIcon } from "@/components/HomeIcon";
import { MetaTeamCard } from "@/components/MetaTeamCard";
import { TYPE_COLORS } from "@/lib/type-meta";
import { getMetaTeams, getMetaTeamsMeta } from "@/lib/pokedex";
import type { MetaTeam } from "@/lib/types";

export const metadata: Metadata = {
  title: "Meta Teams · Champions Pokédex",
  description:
    "The top Pokémon Champions teams right now — real tournament teams with every set, so you can study the meta and plan your counter.",
};

/** "2026-07-19" -> "July 19, 2026". */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[(m ?? 1) - 1]} ${d}, ${y}`;
}

/** A compact row for the sample teams beyond the featured set. */
function SlimTeamRow({ team }: { team: MetaTeam }) {
  const c = team.archetypeType ? TYPE_COLORS[team.archetypeType] : null;
  return (
    <Link
      href={`/teams/${team.slug}`}
      className="glass-quiet flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors active:bg-surface-2"
    >
      <span className="font-display text-xs font-bold tabular-nums text-muted/70">
        {String(team.rank).padStart(2, "0")}
      </span>
      <span
        aria-hidden
        className="h-8 w-[3px] shrink-0 rounded-full"
        style={{ background: c ?? "rgba(255,255,255,0.14)" }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[13px] font-semibold leading-tight">{team.name}</p>
        <p className="truncate text-[11px] text-muted">
          {team.credit
            ? [team.credit.author, team.credit.detail].filter(Boolean).join(" · ")
            : "Community sample team"}
        </p>
      </div>
      <span aria-hidden className="text-muted/60">›</span>
    </Link>
  );
}

export default function TeamsPage() {
  const teams = getMetaTeams();
  const meta = getMetaTeamsMeta();
  const featured = teams.slice(0, meta.topN);
  const rest = teams.slice(meta.topN);

  return (
    <main className="flex min-h-dvh flex-col pb-10">
      <header className="px-4 pt-5">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Home"
            className="tap-target grid size-9 shrink-0 place-items-center rounded-xl glass-quiet text-muted active:bg-surface-2"
          >
            <HomeIcon className="size-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-bold leading-none tracking-tight">
              Meta Teams
            </h1>
            <p className="mt-1 text-sm text-muted">
              {meta.regulationLabel} · top {meta.topN} of {meta.count}
              {meta.generatedAt && (
                <span className="whitespace-nowrap"> · updated {longDate(meta.generatedAt)}</span>
              )}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          Real tournament teams shaping the current ladder — every set intact. Study a build,
          spot its win conditions, then plan your counter.
        </p>
      </header>

      <section className="mt-4 space-y-3 px-4">
        {featured.map((team) => (
          <MetaTeamCard key={team.slug} team={team} />
        ))}
      </section>

      {rest.length > 0 && (
        <section className="mt-7 px-4">
          <h2 className="hud-label mb-2.5 text-[11px]">More sample teams</h2>
          <div className="space-y-1.5">
            {rest.map((team) => (
              <SlimTeamRow key={team.slug} team={team} />
            ))}
          </div>
        </section>
      )}

      <footer className="mt-7 px-4 text-[11px] leading-relaxed text-muted/80">
        Teams from{" "}
        <a
          href={meta.source}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted/40 underline-offset-2"
        >
          {meta.sourceLabel}
        </a>
        , collated from TPCi + grassroots events. Ranked by tournament pedigree.
        Sets are baked at build time — the app makes no live calls.
      </footer>
    </main>
  );
}
