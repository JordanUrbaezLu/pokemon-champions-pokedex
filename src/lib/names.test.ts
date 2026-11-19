/**
 * Official English names, everywhere they are shown.
 *
 * Until 2026-11-18 both generators built names with the SLUG RULE (split the
 * PokeAPI slug on "-", capitalise): moves read "U Turn", "Will O Wisp", "Kings
 * Shield", items "Kings Rock" / "Never Melt Ice", abilities "Good As Gold", and
 * pages "Kommo O" / "Mr Rime" / "Farfetchd". The generators now take Showdown's
 * `name` (pinned commit) first. The oracle here is independent of that path:
 * @smogon/calc's gen 9 tables (Showdown-derived) for every move, ability, item
 * and species they know — Champions-original ones they don't know are skipped.
 */
import { describe, it, expect } from "vitest";
import { Generations } from "@smogon/calc";
import competitiveData from "../data/generated/competitive.json";
import dataset from "../data/generated/pokemon.json";
import { prettySmogonName, searchKey, toDisplayName } from "./format";
import type { CompetitiveDataset, PokedexDataset } from "./types";

const pokedex = dataset as unknown as PokedexDataset;
const competitive = competitiveData as unknown as CompetitiveDataset;
const GEN = Generations.get(9);
// The library's tables take its branded `ID`; the same stripping as everywhere else.
const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "") as never;

/** [what, slug, shown name, the library's official name] for every name the library knows. */
function namesVsLibrary() {
  const rows: { kind: string; slug: string; shown: string; official: string }[] = [];
  const add = (kind: string, slug: string, shown: string, official: string | undefined) => {
    if (official) rows.push({ kind, slug, shown, official });
  };
  for (const m of Object.values(pokedex.moves)) add("move", m.name, m.displayName, GEN.moves.get(toId(m.name))?.name);
  for (const p of pokedex.pokemon) {
    for (const f of [p, ...p.forms]) {
      for (const a of f.abilities) add("ability", a.name, a.displayName, GEN.abilities.get(toId(a.name))?.name);
    }
    // A page whose slug IS a base species (no forme): its name is that species' name.
    const sp = GEN.species.get(toId(p.name)) as { name: string; baseSpecies?: string } | undefined;
    if (sp && (!sp.baseSpecies || sp.baseSpecies === sp.name)) add("species", p.name, p.displayName, sp.name);
  }
  for (const bracket of Object.values(competitive.brackets)) {
    for (const prof of Object.values(bracket)) {
      for (const it of prof.items) add("item", it.slug ?? "", it.displayName, GEN.items.get(toId(it.displayName))?.name);
    }
  }
  for (const [slug, d] of Object.entries(competitive.itemIndex)) add("item sheet", slug, d.displayName, GEN.items.get(toId(slug))?.name);
  return rows;
}

describe("official names (moves, abilities, items, Pokémon)", () => {
  const rows = namesVsLibrary();

  it("every shown name the library knows is its official spelling", () => {
    const wrong = rows.filter((r) => r.shown !== r.official).map((r) => `${r.kind} ${r.slug}: "${r.shown}" ≠ "${r.official}"`);
    expect(wrong).toEqual([]);
    expect(rows.filter((r) => r.kind === "move").length).toBeGreaterThan(450);
    expect(rows.filter((r) => r.kind === "ability").length).toBeGreaterThan(400);
    expect(rows.filter((r) => r.kind === "species").length).toBeGreaterThan(150);
  });

  it("no name is the slug rule's guess where the official name differs (non-vacuous)", () => {
    // The guard above only bites where the two spellings differ — prove there are such names.
    const differs = rows.filter((r) => toDisplayName(r.slug) !== r.official);
    const byKind = (k: string) => new Set(differs.filter((r) => r.kind === k).map((r) => r.shown));
    expect(byKind("move").size).toBeGreaterThanOrEqual(14);
    expect(byKind("ability").size).toBeGreaterThanOrEqual(2);
    expect(byKind("item").size).toBeGreaterThanOrEqual(2);
    expect(byKind("species").size).toBeGreaterThanOrEqual(5);
    for (const r of differs) expect(r.shown, `${r.kind} ${r.slug}`).not.toBe(toDisplayName(r.slug));
  });

  it("canaries: U-turn, Will-O-Wisp, King's Shield, King's Rock, Never-Melt Ice, Kommo-o, Mr. Rime", () => {
    expect(pokedex.moves["u-turn"]?.displayName).toBe("U-turn");
    expect(pokedex.moves["will-o-wisp"]?.displayName).toBe("Will-O-Wisp");
    expect(pokedex.moves["kings-shield"]?.displayName).toBe("King's Shield");
    expect(pokedex.moves["trick-or-treat"]?.displayName).toBe("Trick-or-Treat");
    expect(competitive.itemIndex["kings-rock"]?.displayName).toBe("King's Rock");
    expect(competitive.itemIndex["never-melt-ice"]?.displayName).toBe("Never-Melt Ice");
    const page = (slug: string) => pokedex.pokemon.find((p) => p.name === slug)?.displayName;
    expect(page("kommo-o")).toBe("Kommo-o");
    expect(page("mr-rime")).toBe("Mr. Rime");
    expect(page("farfetchd")).toBe("Farfetch’d");
    // The app's own form conventions stay, around the official species name.
    expect(page("ninetales-alola")).toBe("Alolan Ninetales");
    expect(page("rotom-wash")).toBe("Wash Rotom");
    expect(page("tauros-paldea-aqua-breed")).toBe("Paldean Tauros");
    expect(page("toxtricity-low-key")).toBe("Toxtricity Low Key");
  });
});

describe("partner chips link to the page AND form they name", () => {
  const formLabel = new Map<string, string>();
  const pages = new Map<string, Set<string>>();
  for (const p of pokedex.pokemon) {
    pages.set(p.name, new Set([p.name, ...p.forms.map((f) => f.key)]));
    formLabel.set(p.name, p.displayName);
    for (const f of p.forms) formLabel.set(f.key, f.label);
  }

  it("every linked chip reaches a real page, every formKey a form of that page", () => {
    let linked = 0;
    let forms = 0;
    for (const bracket of Object.values(competitive.brackets)) {
      for (const [key, prof] of Object.entries(bracket)) {
        for (const t of prof.teammates) {
          if (!t.slug) continue;
          linked++;
          expect(pages.has(t.slug), `${key}: ${t.displayName} → ${t.slug}`).toBe(true);
          if (!t.formKey) continue;
          forms++;
          expect(pages.get(t.slug)?.has(t.formKey), `${key}: ${t.displayName} → ${t.slug}?form=${t.formKey}`).toBe(true);
          // A Mega chip reads exactly like the form it opens.
          if (/-Mega\b/.test(t.displayName)) expect(prettySmogonName(t.displayName)).toBe(formLabel.get(t.formKey));
        }
      }
    }
    expect(linked).toBeGreaterThan(1000);
    expect(forms).toBeGreaterThan(300);
  });

  it("a Mega chip never links to the base form; Paldean Tauros (Aqua) opens its own page", () => {
    const chips = Object.values(competitive.brackets).flatMap((b) => Object.values(b).flatMap((p) => p.teammates));
    for (const t of chips.filter((c) => /-Mega\b/.test(c.displayName) && c.slug)) {
      expect(t.formKey, t.displayName).toBeTruthy();
    }
    const tauros = chips.filter((c) => c.displayName === "Tauros-Paldea-Aqua");
    expect(tauros.length).toBeGreaterThan(0);
    for (const t of tauros) expect(t.slug).toBe("tauros-paldea-aqua-breed");
  });
});

describe("searchKey (punctuation-blind search)", () => {
  it("finds the official names however they are typed", () => {
    for (const q of ["uturn", "u turn", "u-turn", "U-Turn"]) expect(searchKey("U-turn").startsWith(searchKey(q)), q).toBe(true);
    for (const q of ["kings rock", "king's rock", "kingsrock"]) expect(searchKey("King's Rock")).toBe(searchKey(q));
    expect(searchKey("Never-Melt Ice")).toBe(searchKey("never melt ice"));
    expect(searchKey("Mr. Rime").startsWith(searchKey("mr rime"))).toBe(true);
    expect(searchKey("Kommo-o")).toBe(searchKey("kommo o"));
    expect(searchKey("Farfetch’d")).toBe(searchKey("farfetch'd"));
    expect(searchKey("Flabébé")).toBe("flabebe");
  });
});
