import { describe, it, expect } from "vitest";
import {
  toDisplayName,
  dexNumber,
  formatMultiplier,
  natureEffect,
  prettySmogonName,
  formatPickRate,
  formatSpread,
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
});

describe("prettySmogonName", () => {
  it("rewrites Mega names", () => {
    expect(prettySmogonName("Aerodactyl-Mega")).toBe("Mega Aerodactyl");
    expect(prettySmogonName("Charizard-Mega-Y")).toBe("Mega Charizard Y");
  });
  it("passes non-Mega names through", () => {
    expect(prettySmogonName("Garchomp")).toBe("Garchomp");
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
