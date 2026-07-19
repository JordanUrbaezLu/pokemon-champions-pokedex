import Link from "next/link";
import { TeamFormation } from "./TeamFormation";
import { TYPE_COLORS } from "@/lib/type-meta";
import type { MetaTeam } from "@/lib/types";

/** The archetype tag — type-tinted for weather archetypes, neutral otherwise
 *  (red stays threat-only, so an "Offense" tag never reads as a threat). */
export function ArchetypeTag({ team }: { team: MetaTeam }) {
  if (!team.archetype) return null;
  const c = team.archetypeType ? TYPE_COLORS[team.archetypeType] : null;
  return (
    <span
      className="hud-label shrink-0 rounded-full px-2 py-0.5 text-[10px]"
      style={
        c
          ? { color: c, background: `${c}1f`, boxShadow: `inset 0 0 0 1px ${c}40` }
          : { background: "rgba(255,255,255,0.05)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }
      }
    >
      {team.archetype}
    </span>
  );
}

/**
 * A meta-team dossier card: the file number, archetype, codename, and — the
 * reason it's here — the real author/event/placement, over the six-mon
 * formation. Tapping it opens the full sets.
 */
export function MetaTeamCard({ team }: { team: MetaTeam }) {
  return (
    <Link
      href={`/teams/${team.slug}`}
      className="glass block rounded-2xl p-3.5 transition-colors active:bg-surface-2"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-display text-sm font-bold tabular-nums text-muted">
          {String(team.rank).padStart(2, "0")}
        </span>
        <ArchetypeTag team={team} />
      </div>

      <h2 className="font-display text-[17px] font-bold leading-tight">{team.name}</h2>

      {team.credit ? (
        <p className="mt-1 text-xs leading-snug text-muted">
          {team.credit.author && (
            <span className="font-semibold text-foreground/85">{team.credit.author}</span>
          )}
          {team.credit.author && team.credit.detail && " · "}
          {team.credit.detail}
          {team.isRecreation && <span className="text-muted/70"> · recreation</span>}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted/70">Community sample team</p>
      )}

      <div className="mt-3">
        <TeamFormation members={team.members} />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-muted">
          {team.members.filter((m) => m.isMega).length >= 1
            ? `${team.members.filter((m) => m.isMega).length} Mega${team.members.filter((m) => m.isMega).length > 1 ? "s" : ""} · 6 Pokémon`
            : "6 Pokémon"}
        </span>
        <span className="font-display text-[11px] font-semibold uppercase tracking-wider text-foreground/65">
          View sets →
        </span>
      </div>
    </Link>
  );
}
