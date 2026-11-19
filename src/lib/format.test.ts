import { describe, it, expect } from "vitest";
import competitiveData from "../data/generated/competitive.json";
import dataset from "../data/generated/pokemon.json";
import type { CompetitiveDataset, PokedexDataset } from "./types";
import {
  toDisplayName,
  dexNumber,
  formatMultiplier,
  formPillLabel,
  megaTabLabel,
  natureEffect,
  prettySmogonName,
  formatPickRate,
  formatKoChance,
  formatSpread,
  formatSpreadSp,
} from "./format";

describe("toDisplayName", () => {
  it("title-cases hyphenated slugs", () => {
    expect(toDisplayName("mr-mime")).toBe("Mr Mime");
    expect(toDisplayName("charizard")).toBe("Charizard");
  });
});

describe("dexNumber", () => {
  it("zero-pads to three digits", () => {
    expect(dexNumber(6)).toBe("#006");
    expect(dexNumber(150)).toBe("#150");
  });
});

describe("formatMultiplier", () => {
  it("renders the reader-friendly fractions", () => {
    expect(formatMultiplier(0)).toBe("0×");
    expect(formatMultiplier(0.25)).toBe("¼×");
    expect(formatMultiplier(0.5)).toBe("½×");
    expect(formatMultiplier(2)).toBe("2×");
    expect(formatMultiplier(4)).toBe("4×");
  });
});

describe("natureEffect", () => {
  it("returns up/down for real natures", () => {
    expect(natureEffect("Modest")).toEqual({ up: "SpA", down: "Atk" });
    expect(natureEffect("Jolly")).toEqual({ up: "Spe", down: "SpA" });
  });
  it("neutral and unknown natures are null", () => {
    expect(natureEffect("Hardy")).toBeNull();
    expect(natureEffect("Nonsense")).toBeNull();
  });
  it("never reads Object.prototype (a nature can come from a saved set in localStorage)", () => {
    for (const key of ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__", "isPrototypeOf"]) {
      expect(natureEffect(key), key).toBeNull();
    }
  });
});

const competitive = competitiveData as unknown as CompetitiveDataset;
const pokedex = dataset as unknown as PokedexDataset;

describe("prettySmogonName", () => {
  it("rewrites Mega names", () => {
    expect(prettySmogonName("Aerodactyl-Mega")).toBe("Mega Aerodactyl");
    expect(prettySmogonName("Charizard-Mega-Y")).toBe("Mega Charizard Y");
  });
  it("rewrites v1.2.0's Z Megas (they used to render raw)", () => {
    expect(prettySmogonName("Garchomp-Mega-Z")).toBe("Mega Garchomp Z");
    expect(prettySmogonName("Absol-Mega-Z")).toBe("Mega Absol Z");
    expect(prettySmogonName("Lucario-Mega-Z")).toBe("Mega Lucario Z");
  });
  it("drops a gender tag before -Mega (one battle-identical form)", () => {
    expect(prettySmogonName("Meowstic-F-Mega")).toBe("Mega Meowstic");
    expect(prettySmogonName("Meowstic-M-Mega")).toBe("Mega Meowstic");
  });
  it("rewrites Primal, regional and Rotom forms the way the app names their pages", () => {
    expect(prettySmogonName("Groudon-Primal")).toBe("Primal Groudon");
    expect(prettySmogonName("Ninetales-Alola")).toBe("Alolan Ninetales");
    expect(prettySmogonName("Slowking-Galar")).toBe("Galarian Slowking");
    expect(prettySmogonName("Arcanine-Hisui")).toBe("Hisuian Arcanine");
    expect(prettySmogonName("Mr. Mime-Galar")).toBe("Galarian Mr. Mime");
    expect(prettySmogonName("Tauros-Paldea-Aqua")).toBe("Paldean Tauros (Aqua)");
    expect(prettySmogonName("Rotom-Wash")).toBe("Wash Rotom");
    expect(prettySmogonName("Rotom-Heat")).toBe("Heat Rotom");
  });
  it("passes names that are already readable through — real hyphens included", () => {
    for (const n of ["Garchomp", "Indeedee-F", "Aegislash-Blade", "Kommo-o", "Porygon-Z", "Ho-Oh", "Mr. Rime", "Rotom"]) {
      expect(prettySmogonName(n), n).toBe(n);
    }
  });
  it("matches the app's own page/form label for every Mega, regional and Rotom profile in the data", () => {
    // Every ladder profile names the page/form it describes (its key); where the
    // Smogon name carries one of the rewritten suffixes, the chip must read
    // exactly like that page's or form's own label.
    const label = new Map<string, string>();
    for (const p of pokedex.pokemon) {
      label.set(p.name, p.displayName);
      for (const f of p.forms) label.set(f.key, f.label);
    }
    const REWRITTEN = /-(Mega|Primal|Alola|Galar|Hisui)\b|^Rotom-/;
    let checked = 0;
    for (const bracket of Object.values(competitive.brackets)) {
      for (const [key, p] of Object.entries(bracket)) {
        const name = p.smogonName ?? "";
        if (p.asForm || !REWRITTEN.test(name)) continue;
        expect(prettySmogonName(name), `${name} (${key})`).toBe(label.get(key));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
  it("leaves no form suffix raw in any teammate chip or KO-benchmark list", () => {
    const shown = new Set<string>();
    for (const bracket of Object.values(competitive.brackets)) {
      for (const p of Object.values(bracket)) {
        for (const t of p.teammates ?? []) shown.add(t.displayName);
        for (const b of p.benchmarks ?? []) for (const n of [...b.ohko, ...b.two]) shown.add(n);
      }
    }
    const raw = [...shown].map(prettySmogonName).filter((n) => /-(Mega|Primal|Alola|Galar|Hisui|Paldea)\b|^Rotom-/.test(n));
    expect(raw).toEqual([]);
    expect(shown.size).toBeGreaterThan(50);
  });
});

describe("megaTabLabel", () => {
  it("reads any suffix letter, so a plain Mega and a Mega Z never share a pill", () => {
    expect(megaTabLabel("Mega Charizard X")).toBe("Mega X");
    expect(megaTabLabel("Mega Charizard Y")).toBe("Mega Y");
    expect(megaTabLabel("Mega Lucario Z")).toBe("Mega Z");
    expect(megaTabLabel("Mega Lucario")).toBe("Mega");
    expect(megaTabLabel("Primal Groudon")).toBe("Primal");
  });
});

describe("formPillLabel (the Calc's form toggle)", () => {
  it("is Base for the base form, the short Mega label for Megas, the label for stance forms", () => {
    expect(formPillLabel({ key: null, label: "Lucario", isMega: false })).toBe("Base");
    expect(formPillLabel({ key: "lucario-mega", label: "Mega Lucario", isMega: true })).toBe("Mega");
    expect(formPillLabel({ key: "lucario-mega-z", label: "Mega Lucario Z", isMega: true })).toBe("Mega Z");
    expect(formPillLabel({ key: "aegislash-blade", label: "Aegislash (Blade Forme)", isMega: false })).toBe("Aegislash (Blade Forme)");
  });
});

describe("formatPickRate", () => {
  it("rounds ≥1%, marks tiny shares, and zero", () => {
    expect(formatPickRate(26)).toBe("26%");
    expect(formatPickRate(26.6)).toBe("27%");
    expect(formatPickRate(0.4)).toBe("<1%");
    expect(formatPickRate(0)).toBe("0%");
  });
});

describe("formatKoChance", () => {
  it("rounds to a whole %, but a real chance never prints as 0% or 100%", () => {
    expect(formatKoChance(30.46875)).toBe("30%"); // Twin Beam into Heracross
    expect(formatKoChance(0.3)).toBe("<1%"); // Population Bomb into Appletun printed "0% OHKO"
    expect(formatKoChance(Number.MIN_VALUE)).toBe("<1%");
    expect(formatKoChance(0.5)).toBe("1%");
    expect(formatKoChance(99.49)).toBe("99%");
    expect(formatKoChance(99.5)).toBe(">99%");
    expect(formatKoChance(99.999)).toBe(">99%");
    expect(formatKoChance(0)).toBe("0%");
    expect(formatKoChance(100)).toBe("100%");
  });
});

describe("formatSpread", () => {
  it("lists invested EVs in canonical stat order", () => {
    expect(
      formatSpread({ nature: "Jolly", evs: { atk: 252, spe: 252, spd: 4 } }),
    ).toBe("252 Atk / 4 SpD / 252 Spe");
  });
  it("omits zero-EV stats", () => {
    expect(formatSpread({ nature: "Modest", evs: { spa: 252, hp: 4 } })).toBe(
      "4 HP / 252 SpA",
    );
  });
});

describe("formatSpreadSp", () => {
  it("renders the spread in Stat Points with the SP suffix", () => {
    expect(
      formatSpreadSp({ nature: "Jolly", evs: { atk: 252, spe: 252, spd: 4 } }),
    ).toBe("32 Atk / 1 SpD / 32 Spe SP");
  });
  it("omits zero-EV stats and returns empty for an empty spread", () => {
    expect(formatSpreadSp({ nature: "Modest", evs: { spa: 252 } })).toBe(
      "32 SpA SP",
    );
    expect(formatSpreadSp({ nature: "Hardy", evs: {} })).toBe("");
  });
});
