"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HomeIcon } from "@/components/HomeIcon";
import { TypeBadge } from "@/components/TypeBadge";
import { StatBars } from "@/components/StatBars";
import { AbilityList } from "@/components/AbilityList";
import { MovesSection } from "@/components/MovesSection";
import { ItemModal } from "@/components/ItemModal";
import { MoveModal } from "@/components/MoveModal";
import { PinButton } from "@/components/PinButton";
import { SpeedPanel } from "@/components/SpeedPanel";
import { ThreatProfileCard } from "@/components/ThreatProfileCard";
import { TypeMatchups } from "@/components/TypeMatchups";
import { useBracket } from "@/lib/bracket";
import { useOpponents } from "@/lib/opponents";
import { speedAnchors } from "@/lib/battle";
import { effectiveDefensiveProfile } from "@/lib/type-chart";
import { TYPE_COLORS } from "@/lib/type-meta";
import {
  dexNumber,
  formatPickRate,
  formatSpread,
  natureEffect,
  prettySmogonName,
} from "@/lib/format";
import type { ThreatProfile } from "@/lib/threat";
import type {
  BattleForm,
  ChampionPokemon,
  CompetitiveMeta,
  CompetitiveProfile,
  DataBracket,
  ItemDetail,
  MoveSummary,
} from "@/lib/types";

// Runs before paint on the client, falls back to a no-op effect during SSR so
// it never logs the "useLayoutEffect on the server" warning.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Section card with a compact heading — the building block of the detail screen. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl glass-quiet p-3.5">
      <h2 className="hud-label mb-2.5 text-[11px]">{title}</h2>
      {children}
    </section>
  );
}

/** Compact label for the form toggle, e.g. "Mega Charizard X" -> "Mega X". */
function shortFormLabel(form: BattleForm, baseDisplayName: string): string {
  return form.label.replace(baseDisplayName, "").replace(/\s+/g, " ").trim();
}

const stripId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The most-used ability among this form's own abilities, with its %. */
function topAbility(
  abilities: BattleForm["abilities"],
  usage: Record<string, number> | undefined,
): { label: string; pct: number } | null {
  if (!usage) return null;
  let best: { label: string; pct: number } | null = null;
  for (const a of abilities) {
    const pct = usage[stripId(a.name)];
    if (pct != null && (!best || pct > best.pct)) best = { label: a.displayName, pct };
  }
  return best;
}

export function PokemonDetail({
  pokemon,
  moves,
  competitiveByBracket,
  competitiveMeta,
  itemDetails,
  threatByBracket,
}: {
  pokemon: ChampionPokemon;
  moves: MoveSummary[];
  competitiveByBracket: Record<DataBracket, Record<string, CompetitiveProfile>>;
  competitiveMeta: CompetitiveMeta;
  itemDetails: Record<string, ItemDetail>;
  threatByBracket: Record<DataBracket, Record<string, ThreatProfile>>;
}) {
  // Unify the base form and any Mega/Primal forms into one toggle list.
  const baseForm: BattleForm = {
    key: pokemon.name,
    label: pokemon.displayName,
    kind: "mega", // unused for base; kind only matters for alt forms
    types: pokemon.types,
    stats: pokemon.stats,
    abilities: pokemon.abilities,
    sprite: pokemon.sprite,
    artwork: pokemon.artwork,
  };
  const forms = [baseForm, ...pokemon.forms];

  const router = useRouter();
  // Default to the form that has ladder data — e.g. base Meganium has none but
  // Mega Meganium does. Uses the default bracket's map so it stays
  // SSR-deterministic (no window, no stored state) and never causes a
  // hydration mismatch; the ?form= deep-link is applied in the layout effect below.
  const [activeIndex, setActiveIndex] = useState(() => {
    const defaultByForm = competitiveByBracket.master;
    if (defaultByForm[pokemon.name]) return 0;
    const i = pokemon.forms.findIndex((f) => defaultByForm[f.key]);
    return i >= 0 ? i + 1 : 0;
  });
  // Deep-link: ?form=<key> (e.g. tapping the home Mega badge) opens straight on
  // that form. Applied before paint so there's no Base→Mega flash, and it works
  // for both a full page load and a client-side navigation.
  useIsomorphicLayoutEffect(() => {
    const form = new URLSearchParams(window.location.search).get("form");
    if (!form) return;
    const i = forms.findIndex((f) => f.key === form);
    if (i >= 0) setActiveIndex(i);
  }, []);
  const [selectedItem, setSelectedItem] = useState<{
    item: ItemDetail;
    usagePct: number;
  } | null>(null);
  const [selectedMove, setSelectedMove] = useState<MoveSummary | null>(null);
  const [bracket, setBracket] = useBracket();
  const active = forms[activeIndex];
  const tint = TYPE_COLORS[active.types[0]];
  const comp = competitiveByBracket[bracket][active.key];
  const threat = threatByBracket[bracket][active.key];
  // For the "no data here, but the other bracket has it" hint.
  const compInAll = competitiveByBracket.all[active.key];

  // Opponent pinning: one tap at team preview → one-tap return all battle.
  // Form-aware: a base pin can be upgraded to its Mega in one tap (and vice
  // versa), since the tray keys one slot per species.
  const { opponents, pin, unpin, isFull } = useOpponents();
  const pinned = opponents.find((o) => o.slug === pokemon.name);
  const pinnedFormKey = pinned ? pinned.formKey ?? pokemon.name : null;
  const isPinned = pinnedFormKey === active.key;
  const togglePin = () => {
    if (isPinned) {
      unpin(pokemon.name);
      return;
    }
    const isBase = active.key === pokemon.name;
    pin({
      slug: pokemon.name,
      formKey: isBase ? null : active.key,
      // Identify the form you'll actually face — "Mega Charizard Y", not just
      // "Charizard" — so the tray and briefing name the real threat.
      displayName: active.label,
      icon: isBase
        ? pokemon.home ?? pokemon.sprite
        : active.artwork ?? active.sprite ?? pokemon.home ?? pokemon.sprite,
      types: active.types,
      // Ability-aware so the tray/briefing 4× tag never promises a kill an
      // ability negates (a Levitate mon is not "4× weak to Ground").
      quad:
        effectiveDefensiveProfile(active.types, active.abilities.map((a) => a.name))
          .quad[0] ?? null,
      speed: comp ? speedAnchors(active.stats, comp.spread).common : null,
      archetype: threat?.archetype ?? [],
      headline: threat?.vectors[0]?.headline ?? null,
    });
  };

  return (
    <main className="flex min-h-dvh flex-col">
      {/* Sticky top bar: back = previous Pokémon (e.g. after following a
          partner link), and a dedicated centered Home button. Chrome is kept
          strictly neutral — on this screen red means one thing only: threat. */}
      <div className="sticky top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-background/90 px-1 py-1.5 backdrop-blur">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="flex size-11 items-center justify-center justify-self-start rounded-full text-xl text-muted active:bg-surface-2"
        >
          ‹
        </button>
        <Link
          href="/"
          aria-label="Home"
          className="flex size-11 items-center justify-center justify-self-center rounded-full border border-border bg-surface text-muted active:bg-surface-2"
        >
          <HomeIcon className="size-5" />
        </Link>
        <div className="flex items-center gap-2 justify-self-end pr-3">
          {/* Run the numbers on this mon — seeds it as the calc's attacker. */}
          <Link
            href={`/calc?a=${pokemon.name}`}
            aria-label="Open in Battle Calc"
            className="tap-target rounded-md bg-surface-2 px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-wider text-muted active:bg-surface"
          >
            Calc
          </Link>
          <span className="font-mono text-xs tabular-nums text-muted">{dexNumber(pokemon.id)}</span>
        </div>
      </div>

      {/* Hero, battle-compact: small render, name, types and pick rate in one
          tight block — the Threat Profile is the star, so it must clear the
          fold. The artwork is for recognition, not admiration. */}
      <div
        className="relative px-4 pb-3 pt-2 animate-[fadeUp_.3s_ease-out]"
        style={{
          background: `radial-gradient(130% 92% at 0% 0%, ${tint}3d, transparent 60%)`,
        }}
      >
        <div className="flex items-center gap-3.5">
          {/* The signature: the opponent acquired by a targeting reticle. A
              type-tinted plate gives the frame something to hold; four corner
              brackets in the type color snap on once as the page settles. Kept
              compact on purpose so the Threat Profile still clears the fold. */}
          <div className="relative shrink-0">
            <div
              className="flex size-30 items-center justify-center rounded-2xl"
              style={{
                background: `radial-gradient(circle at 50% 36%, ${tint}30, ${tint}0a)`,
                border: `1px solid ${tint}2b`,
              }}
            >
              {active.artwork ? (
                <Image
                  key={active.key}
                  src={active.artwork}
                  alt={active.label}
                  width={240}
                  height={240}
                  className="size-26 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
                  priority
                  // Served straight from the CDN (no on-demand optimizer step) so
                  // the URL is stable and warmed by the home list's prefetch.
                  unoptimized
                />
              ) : null}
            </div>
            <div
              className="pointer-events-none absolute -inset-1 animate-[lockIn_.4s_ease-out_both]"
              aria-hidden
            >
              {[
                "left-0 top-0 border-l-2 border-t-2 rounded-tl-lg",
                "right-0 top-0 border-r-2 border-t-2 rounded-tr-lg",
                "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg",
                "bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg",
              ].map((corner) => (
                <span
                  key={corner}
                  className={`absolute size-4 ${corner}`}
                  // Lift the type hue toward white so the reticle stays legible
                  // even for the dark types (Dark/Ghost/Poison) whose brand color
                  // all but disappears on the near-black background.
                  style={{ borderColor: `color-mix(in srgb, ${tint} 62%, #fff)` }}
                />
              ))}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[25px] font-bold leading-[1.02] tracking-tight">
              {active.label}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {active.types.map((t) => (
                <TypeBadge key={t} type={t} size="sm" />
              ))}
              {comp && (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
                  style={{ backgroundColor: `${tint}26`, color: tint }}
                >
                  {formatPickRate(comp.usagePct)} pick
                </span>
              )}
              {pokemon.isNew && (
                // Newly added to Champions — flag it so a trainer who's never
                // faced this mon knows to read its kit. Cyan (red = threat only).
                <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-bold text-sky-300 ring-1 ring-inset ring-sky-400/30">
                  New to Champions
                </span>
              )}
            </div>
          </div>
          {/* Pin as opponent: tap at team preview, return in one tap all battle. */}
          <PinButton
            pinned={isPinned}
            onToggle={togglePin}
            disabled={!isPinned && isFull}
            pinLabel="Pin as opponent"
            unpinLabel="Unpin opponent"
            caption
            className="size-11 self-center text-base"
          />
        </div>

        {forms.length > 1 && (
          <div className="no-scrollbar mx-auto mt-1.5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-surface-2 p-0.5">
            {forms.map((form, i) => (
              <button
                key={form.key}
                type="button"
                onClick={() => setActiveIndex(i)}
                className={`shrink-0 rounded-full px-3.5 py-1 text-xs font-bold transition-colors ${
                  i === activeIndex
                    ? "bg-accent text-white"
                    : "text-muted active:bg-surface"
                }`}
              >
                {i === 0
                  ? pokemon.baseFormLabel ?? "Base"
                  : form.tab ?? shortFormLabel(form, pokemon.displayName)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2.5 px-4 pb-10 pt-1 animate-[fadeUp_.34s_ease-out_.05s_both]">
        {!comp &&
          (bracket === "master" && compInAll ? (
            // Too rare at Master+ — but the whole-ladder read exists. Flip the
            // bracket in place (one tap) instead of sending them back to home.
            <button
              type="button"
              onClick={() => setBracket("all")}
              className="mx-1 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-left text-xs text-muted active:bg-accent/20"
            >
              Too rare at Master+ for meaningful data.{" "}
              <span className="font-bold text-accent">
                See its whole-ladder read ›
              </span>
            </button>
          ) : (
            <p className="px-1 text-xs text-muted">
              No Champions ladder data for this form yet.
            </p>
          ))}

        {threat && (
          <ThreatProfileCard
            profile={threat}
            moves={moves}
            usage={comp?.moveUsage}
            types={active.types}
            abilities={active.abilities.map((a) => a.name)}
            ability={topAbility(active.abilities, comp?.abilityUsage)}
            item={
              comp?.items[0]
                ? { label: comp.items[0].displayName, pct: comp.items[0].usagePct }
                : null
            }
            benchmarks={comp?.benchmarks}
            onOpenMove={setSelectedMove}
          />
        )}

        <SpeedPanel
          // Distinct per-sibling prefix: SpeedPanel and MovesSection are both
          // keyed by the form so switching forms remounts them (resetting their
          // internal toggles), but a bare `active.key` collides between the two
          // siblings — React then duplicates/omits one (it rendered the Speed
          // panel twice). The prefix keeps the remount, drops the collision.
          key={`speed-${active.key}`}
          stats={active.stats}
          comp={comp}
          abilities={active.abilities.map((a) => a.name)}
        />

        <Section title="Base Stats">
          <StatBars stats={active.stats} spread={comp?.spread ?? null} />
          {comp?.spread &&
            (() => {
              const eff = natureEffect(comp.spread.nature);
              return (
                <div className="mt-3 border-t border-border pt-2.5 text-sm">
                  <p>
                    <span className="text-muted">Common spread · </span>
                    <span className="font-semibold">{comp.spread.nature}</span>
                    {eff && (
                      <span className="text-muted">
                        {" "}
                        (<span className="text-green-400">{eff.up} ↑</span>{" "}
                        <span className="text-accent">{eff.down} ↓</span>)
                      </span>
                    )}
                    <span className="text-muted"> · {formatSpread(comp.spread)}</span>
                  </p>
                </div>
              );
            })()}
        </Section>

        <Section title="Abilities">
          <AbilityList abilities={active.abilities} usage={comp?.abilityUsage} />
        </Section>

        {comp && comp.items.length > 0 && (
          <Section title="Common Items">
            <ul className="flex flex-col gap-1.5">
              {comp.items.map((it, i) => {
                const isTop = i === 0; // items arrive sorted by usage
                const detail = it.slug ? itemDetails[it.slug] : undefined;
                const cls = `flex w-full items-center gap-2 rounded-lg border bg-surface px-3 py-2 ${
                  isTop ? "border-accent/50" : "border-transparent"
                }`;
                const content = (
                  <>
                    <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
                      {it.displayName}
                    </span>
                    {isTop && (
                      <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                        Most used
                      </span>
                    )}
                    <span
                      className={`shrink-0 font-mono text-sm font-bold tabular-nums ${
                        isTop ? "text-accent" : "text-muted"
                      }`}
                    >
                      {it.usagePct}%
                    </span>
                    {detail && (
                      <span className="shrink-0 text-muted" aria-hidden>
                        ›
                      </span>
                    )}
                  </>
                );
                return (
                  <li key={it.displayName}>
                    {detail ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedItem({ item: detail, usagePct: it.usagePct })
                        }
                        className={`${cls} active:bg-surface-2`}
                      >
                        {content}
                      </button>
                    ) : (
                      <div className={cls}>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        <MovesSection
          key={`moves-${active.key}`}
          moves={moves}
          usage={comp?.moveUsage}
          benchmarks={comp?.benchmarks}
        />

        {comp && comp.teammates.length > 0 && (
          <Section title="Common Partners">
            <div className="flex flex-wrap gap-1.5">
              {comp.teammates.map((t, i) => {
                const isTop = i === 0; // teammates arrive sorted by usage
                const cls = `rounded-full border px-3 py-1 text-sm font-semibold ${
                  isTop ? "border-accent/60 bg-accent/10" : "border-border bg-surface"
                }`;
                const inner = (
                  <>
                    {prettySmogonName(t.displayName)}{" "}
                    <span className="font-mono text-xs text-muted">{t.usagePct}%</span>
                  </>
                );
                return t.slug ? (
                  <Link
                    key={t.displayName}
                    href={`/pokemon/${t.slug}`}
                    className={`${cls} active:bg-surface-2`}
                  >
                    {inner}
                  </Link>
                ) : (
                  <span key={t.displayName} className={cls}>
                    {inner}
                  </span>
                );
              })}
            </div>
          </Section>
        )}

        <TypeMatchups
          types={active.types}
          abilities={active.abilities.map((a) => a.name)}
        />

        {comp && (
          <p className="px-1 text-[11px] leading-snug text-muted/70">
            {comp.asForm && `Competitive data shown for ${comp.asForm}. `}
            {competitiveMeta.formatLabel} · {bracket === "master" ? "Master+" : "all ranks"} ·{" "}
            {competitiveMeta.month}
          </p>
        )}
      </div>

      {selectedMove && (
        <MoveModal
          move={selectedMove}
          benchmark={comp?.benchmarks?.find((b) => b.move === selectedMove.name)}
          onClose={() => setSelectedMove(null)}
        />
      )}

      {selectedItem && (
        <ItemModal
          item={selectedItem.item}
          usagePct={selectedItem.usagePct}
          onClose={() => setSelectedItem(null)}
        />
      )}

    </main>
  );
}
