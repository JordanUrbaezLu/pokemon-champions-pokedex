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
import { RoleModal } from "@/components/RoleModal";
import { TYPE_COLORS } from "@/lib/type-meta";
import { getDoublesRoles, ROLE_TONE, type DoublesRole } from "@/lib/battle";
import {
  dexNumber,
  formatPickRate,
  formatSpread,
  natureEffect,
} from "@/lib/format";
import type {
  BattleForm,
  ChampionPokemon,
  CompetitiveMeta,
  CompetitiveProfile,
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
    <section className="rounded-2xl border border-border bg-surface/60 p-3.5">
      <h2 className="mb-2.5 text-xs font-black uppercase tracking-wider text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Compact label for the form toggle, e.g. "Mega Charizard X" -> "Mega X". */
function shortFormLabel(form: BattleForm, baseDisplayName: string): string {
  return form.label.replace(baseDisplayName, "").replace(/\s+/g, " ").trim();
}

export function PokemonDetail({
  pokemon,
  moves,
  competitiveByForm,
  competitiveMeta,
  itemDetails,
}: {
  pokemon: ChampionPokemon;
  moves: MoveSummary[];
  competitiveByForm: Record<string, CompetitiveProfile>;
  competitiveMeta: CompetitiveMeta;
  itemDetails: Record<string, ItemDetail>;
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
  // Mega Meganium does. Kept SSR-deterministic (no window) so it never causes a
  // hydration mismatch; the ?form= deep-link is applied in the layout effect below.
  const [activeIndex, setActiveIndex] = useState(() => {
    if (competitiveByForm[pokemon.name]) return 0;
    const i = pokemon.forms.findIndex((f) => competitiveByForm[f.key]);
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
  const [selectedRole, setSelectedRole] = useState<DoublesRole | null>(null);
  const active = forms[activeIndex];
  const tint = TYPE_COLORS[active.types[0]];
  const comp = competitiveByForm[active.key];

  return (
    <main className="flex min-h-dvh flex-col">
      {/* Sticky top bar: back = previous Pokémon (e.g. after following a
          partner link), and a dedicated centered Home button. */}
      <div className="sticky top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-background/90 px-2 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="flex size-9 items-center justify-center justify-self-start rounded-full text-xl active:bg-surface-2"
        >
          ‹
        </button>
        <Link
          href="/"
          aria-label="Home"
          className="flex size-9 items-center justify-center justify-self-center rounded-full border-2 border-accent text-accent active:bg-accent/15"
        >
          <HomeIcon className="size-4.5" />
        </Link>
        <span className="justify-self-end pr-2 font-mono text-xs text-muted">
          {dexNumber(pokemon.id)}
        </span>
      </div>

      {/* Hero: large artwork beside name, types, and doubles pick rate. */}
      <div
        className="px-4 pb-3 pt-2"
        style={{
          background: `radial-gradient(130% 90% at 0% 0%, ${tint}38, transparent 62%)`,
        }}
      >
        <div className="flex items-center gap-3">
          {active.artwork ? (
            <Image
              key={active.key}
              src={active.artwork}
              alt={active.label}
              width={320}
              height={320}
              className="size-40 shrink-0 object-contain drop-shadow-[0_6px_16px_rgba(0,0,0,0.45)]"
              priority
              // Served straight from the CDN (no on-demand optimizer step) so the
              // URL is stable and can be warmed by the home list's prefetch.
              unoptimized
            />
          ) : null}
          <div className="min-w-0">
            <h1 className="text-[22px] font-black leading-tight">{active.label}</h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {active.types.map((t) => (
                <TypeBadge key={t} type={t} size="md" />
              ))}
            </div>
            {comp && (
              <span
                className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold"
                style={{ backgroundColor: `${tint}26`, color: tint }}
              >
                {formatPickRate(comp.usagePct)} pick rate
              </span>
            )}
          </div>
        </div>

        {forms.length > 1 && (
          <div className="no-scrollbar mx-auto mt-2.5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-surface-2 p-1">
            {forms.map((form, i) => (
              <button
                key={form.key}
                type="button"
                onClick={() => setActiveIndex(i)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
                  i === activeIndex
                    ? "bg-accent text-white"
                    : "text-muted active:bg-surface"
                }`}
              >
                {i === 0 ? "Base" : shortFormLabel(form, pokemon.displayName)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2.5 px-4 pb-10 pt-1">
        {comp &&
          (() => {
            const roles = getDoublesRoles(comp);
            return roles.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {roles.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => setSelectedRole(r)}
                    className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold active:opacity-70"
                    style={{
                      backgroundColor: `${ROLE_TONE[r.tone]}22`,
                      color: ROLE_TONE[r.tone],
                    }}
                  >
                    {r.label}
                    <span className="opacity-60" aria-hidden>
                      ⓘ
                    </span>
                  </button>
                ))}
              </div>
            ) : null;
          })()}

        {!comp && (
          <p className="px-1 text-xs text-muted">
            No Champions ladder data for this form yet.
          </p>
        )}

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
                      <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
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

        {comp && comp.setupThreats.length > 0 && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5">
            <div className="flex items-center gap-2">
              <span
                className="flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-black text-black"
                aria-hidden
              >
                !
              </span>
              <h2 className="text-xs font-black uppercase tracking-wider text-amber-200/90">
                Watch for set-up
              </h2>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {comp.setupThreats.map((s) => (
                <span
                  key={s.displayName}
                  className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-100"
                >
                  {s.displayName} {s.usagePct}%
                </span>
              ))}
            </div>
          </div>
        )}

        <MovesSection key={active.key} moves={moves} usage={comp?.moveUsage} />

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
                    {t.displayName}{" "}
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

        {comp && (
          <p className="px-1 text-[11px] leading-snug text-muted/80">
            {comp.asForm && `Competitive data shown for ${comp.asForm}. `}
            Smogon {competitiveMeta.formatLabel} · {competitiveMeta.month} ·{" "}
            {competitiveMeta.battles.toLocaleString()} ladder battles.
          </p>
        )}
      </div>

      {selectedItem && (
        <ItemModal
          item={selectedItem.item}
          usagePct={selectedItem.usagePct}
          onClose={() => setSelectedItem(null)}
        />
      )}

      {selectedRole && (
        <RoleModal role={selectedRole} onClose={() => setSelectedRole(null)} />
      )}
    </main>
  );
}
