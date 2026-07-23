import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchetypeTag } from "@/components/MetaTeamCard";
import { TeamFormation } from "@/components/TeamFormation";
import { TeamSetCard } from "@/components/TeamSetCard";
import { getMetaTeamBySlug, getMetaTeams, getMetaTeamsMeta, getMoveBySlug } from "@/lib/pokedex";
import type { PokemonType } from "@/lib/types";

// The teams are a fixed, known set, so prerender every detail page and 404
// anything off-list — each opens instantly with zero data fetching.
export const dynamicParams = false;

export function generateStaticParams() {
  return getMetaTeams().map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const team = getMetaTeamBySlug(slug);
  if (!team) return { title: "Not found · Champions Pokédex" };
  const mons = team.members.map((m) => m.formLabel).join(", ");
  return {
    title: `${team.name} · Meta Teams · Champions Pokédex`,
    description: `${team.name}${team.credit?.author ? ` by ${team.credit.author}` : ""} — full sets for ${mons}.`,
  };
}

export default async function TeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const team = getMetaTeamBySlug(slug);
  if (!team) notFound();
  const meta = getMetaTeamsMeta();

  // Paste move names → types, resolved at build time so the set cards can
  // type-dot their move chips at zero client cost. Unmapped names get no dot.
  const slugifyMove = (n: string) =>
    n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const moveTypes: Record<string, PokemonType> = {};
  for (const m of team.members) {
    for (const mv of m.moves) {
      const t = getMoveBySlug(slugifyMove(mv))?.type;
      if (t) moveTypes[mv] = t;
    }
  }

  return (
    <main className="flex min-h-dvh flex-col pb-10">
      <header className="px-4 pt-5">
        {/* -m/p padding keeps the visual size while the tap box clears 44px. */}
        <Link
          href="/teams"
          className="-m-3 inline-flex items-center gap-1 p-3 text-xs font-medium text-muted active:opacity-70"
        >
          <span aria-hidden>‹</span> Meta Teams
        </Link>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="font-display text-sm font-bold tabular-nums text-muted">
            {String(team.rank).padStart(2, "0")}
          </span>
          <ArchetypeTag team={team} />
        </div>

        <h1 className="mt-1 font-display text-2xl font-bold leading-tight">{team.name}</h1>

        {team.credit ? (
          <p className="mt-1.5 text-[13px] leading-snug text-muted">
            {team.credit.author && (
              <span className="font-semibold text-foreground/85">{team.credit.author}</span>
            )}
            {team.credit.author && team.credit.detail && " · "}
            {team.credit.detail}
            {team.isRecreation && <span className="text-muted/70"> · set recreation</span>}
          </p>
        ) : (
          <p className="mt-1.5 text-[13px] text-muted/70">Community sample team</p>
        )}

        <div className="mt-4 rounded-2xl glass p-3.5">
          <TeamFormation members={team.members} labelled />
        </div>
      </header>

      <section className="mt-6 px-4">
        <h2 className="hud-label mb-3 text-[11px]">Sets</h2>
        <div className="space-y-2.5">
          {team.members.map((m, i) => (
            <TeamSetCard key={`${m.slug ?? m.name}-${i}`} member={m} moveTypes={moveTypes} />
          ))}
        </div>
      </section>

      <footer className="mt-6 px-4 text-[11px] leading-relaxed text-muted/80">
        Source:{" "}
        <a
          href={team.pasteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted/40 underline-offset-2"
        >
          PokéPaste
        </a>
        , listed on{" "}
        <a
          href={meta.source}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted/40 underline-offset-2"
        >
          {meta.sourceLabel}
        </a>
        . Champions is doubles, Lv 50, no Terastallization.
      </footer>
    </main>
  );
}
