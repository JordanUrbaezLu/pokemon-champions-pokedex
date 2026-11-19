// @ts-check
/**
 * Pokémon Showdown's Champions data — the source of every fact about the GAME
 * itself (which Pokémon/forms exist, per-form movepools, Champions move
 * patches, the held-item pool, Mega + Champions-original abilities).
 *
 * Why Showdown: the app ships to the App Store, and Showdown's server repo is
 * MIT-licensed ("Copyright (c) 2011-2026 Guangcong Luo and other contributors")
 * — reuse is explicitly permitted. Its `data/mods/champions` mod is maintained
 * against the live game (v1.2.0 / Reg M-C landed the day it shipped), and it is
 * what Smogon's own Champions ladder validates teams with.
 *
 * Reproducibility: everything is read at ONE pinned commit, so a re-bake is
 * byte-reproducible and a Showdown change can never move the data silently.
 * To bump: pick a newer commit on smogon/pokemon-showdown master, try it with
 * `SHOWDOWN_SHA=<sha> npm run data`, review the movepool diff, then paste the
 * SHA (and its date) below. `npm run status` fails while the baked SHA and
 * this constant disagree.
 *
 * Safety: the data files are TypeScript modules that also contain battle
 * callbacks. Nothing downloaded is ever executed — `parseDataModule` walks the
 * TypeScript AST and keeps only literal values (strings, numbers, booleans,
 * null/undefined, arrays, objects); every function/method becomes the inert
 * `FN` marker, and any other expression is a hard error.
 */

import { createRequire } from "node:module";

// TypeScript (a devDependency) is loaded only when a file is actually parsed,
// so importing the pin constants (status.mjs) stays instant.
const require = createRequire(import.meta.url);
/** @type {typeof import("typescript") | null} */
let tsModule = null;
const loadTs = () => (tsModule ??= require("typescript"));

/** smogon/pokemon-showdown master, 2026-11-16 ("Clarify meaning of `comma-seperated values` in /tour"). */
export const PINNED_SHOWDOWN_SHA = "f827a1d41064e0dec4c19c6ea0394fcf0c23479c";
export const PINNED_SHOWDOWN_DATE = "2026-11-16";
/** The commit actually used this run (`SHOWDOWN_SHA` env = trial bump). */
export const SHOWDOWN_SHA = process.env.SHOWDOWN_SHA || PINNED_SHOWDOWN_SHA;
export const SHOWDOWN_REPO = "smogon/pokemon-showdown";
export const SHOWDOWN_LICENSE = "MIT — Copyright (c) 2011-2026 Guangcong Luo and other contributors";
const RAW = (sha) => `https://raw.githubusercontent.com/${SHOWDOWN_REPO}/${sha}`;

const MOD = "data/mods/champions";
/** Every file read, by role. The mod overrides; the base data is what it inherits. */
export const SHOWDOWN_FILES = {
  modLearnsets: `${MOD}/learnsets.ts`,
  modMoves: `${MOD}/moves.ts`,
  modItems: `${MOD}/items.ts`,
  modAbilities: `${MOD}/abilities.ts`,
  modFormatsData: `${MOD}/formats-data.ts`,
  pokedex: "data/pokedex.ts",
  moves: "data/moves.ts",
  items: "data/items.ts",
  abilities: "data/abilities.ts",
  movesText: "data/text/moves.ts",
  abilitiesText: "data/text/abilities.ts",
  itemsText: "data/text/items.ts",
  // Read as TEXT only (tripwires below) — the rules we mirror live in code.
  modScripts: `${MOD}/scripts.ts`,
  dexSpecies: "sim/dex-species.ts",
};

/**
 * Rules the Champions mod implements in CODE that the generator mirrors by
 * hand. If Showdown rewrites one, the mirrored copy would silently diverge — so
 * each is asserted verbatim against the pinned source, and a bump that changes
 * one fails the bake until someone re-reads the new rule.
 */
const TRIPWIRES = [
  // scripts.ts init(): every move's PP is capped at 20 (in the base PP scale)…
  ["modScripts", "if (this.data.Moves[i].pp > 20) {"],
  ["modScripts", "this.modData('Moves', i).pp = 20;"],
  // …and the in-battle PP is (pp / 5 + 1) × 4 — 5 → 8, 10 → 12, 15 → 16, 20 → 20.
  ["modScripts", "return move.noPPBoosts ? move.pp : (move.pp / 5 + 1) * 4;"],
  // dex-species.ts learnsetParent(): a Champions learnset never inherits its
  // pre-evolution's moves (the mod's learnsets are complete per species/form).
  ["dexSpecies", "if (this.dex.currentMod.startsWith('champions')) return null;"],
];

/** Marker for a function-valued property (a battle callback we never run). */
export const FN = Object.freeze({ __showdownFunction: true });

/**
 * Parse a Showdown data module (`export const X: T = {...}`) into plain data,
 * WITHOUT executing it. Returns `{ [exportName]: value }`.
 */
export function parseDataModule(text, fileName) {
  const ts = loadTs();
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = {};
  const where = (node) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return `${fileName}:${line + 1}:${character + 1}`;
  };
  const propName = (name) => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    if (ts.isPrivateIdentifier(name)) return name.text;
    throw new Error(`unsupported property name at ${where(name)}`);
  };
  /** @param {any} node a TypeScript expression node */
  const value = (node) => {
    while (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node)
    ) {
      node = node.expression;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const obj = {};
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p)) obj[propName(p.name)] = value(p.initializer);
        else if (ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p))
          obj[propName(p.name)] = FN;
        else throw new Error(`unsupported object member (${ts.SyntaxKind[p.kind]}) at ${where(p)}`);
      }
      return obj;
    }
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.map((e) => {
        if (ts.isSpreadElement(e) || ts.isOmittedExpression(e))
          throw new Error(`unsupported array element at ${where(e)}`);
        return value(e);
      });
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
      if (node.operator === ts.SyntaxKind.MinusToken) return -Number(node.operand.text);
      if (node.operator === ts.SyntaxKind.PlusToken) return Number(node.operand.text);
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(node) && node.text === "undefined") return undefined;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return FN;
    throw new Error(`non-literal expression (${ts.SyntaxKind[node.kind]}) at ${where(node)}`);
  };
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) {
      if (ts.isImportDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) continue;
      throw new Error(`unexpected top-level ${ts.SyntaxKind[stmt.kind]} in ${fileName}`);
    }
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      out[decl.name.text] = value(decl.initializer);
    }
  }
  return out;
}

/** Fetch one file at the pinned commit, with patient retries. */
async function fetchFile(path, sha, userAgent) {
  const url = `${RAW(sha)}/${path}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": userAgent } });
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
      return await res.text();
    } catch (err) {
      if (attempt >= 6) throw err;
      await new Promise((r) => setTimeout(r, Math.min(15000, 800 * 2 ** (attempt - 1))));
    }
  }
}

/** Showdown's toID. */
export const toId = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Mod inheritance exactly as Showdown's `Dex.loadData` does it: a child entry
 * replaces the parent's, `inherit: true` shallow-merges onto it (child wins —
 * an explicit `undefined` deliberately erases the parent's field), `null`
 * deletes it, and an absent entry is inherited whole.
 */
function inherit(parent, child) {
  /** The entry minus its `inherit` marker. */
  const own = (entry) => {
    const copy = { ...entry };
    delete copy.inherit;
    return copy;
  };
  const table = { ...child };
  for (const id of Object.keys(parent)) {
    if (table[id] === null) delete table[id];
    else if (!(id in table)) table[id] = parent[id];
    else if (table[id]?.inherit) table[id] = { ...parent[id], ...own(table[id]) };
  }
  for (const id of Object.keys(table)) {
    if (table[id] && typeof table[id] === "object" && "inherit" in table[id]) table[id] = own(table[id]);
  }
  return table;
}

/**
 * Text resolution as Showdown's `resolveTextField` does for the `champions`
 * mod: a `champions` sub-entry wins field by field. `championsSpecific` says
 * Showdown wrote Champions-only text for it (the mechanics differ from mainline).
 */
function resolveText(entry) {
  if (!entry) return { desc: "", shortDesc: "", championsSpecific: false };
  const pick = (field) => entry.champions?.[field] || entry[field] || "";
  const desc = pick("desc");
  const shortDesc = pick("shortDesc");
  return { desc: desc || shortDesc, shortDesc: shortDesc || desc, championsSpecific: !!entry.champions };
}

/**
 * Load the Champions dex at the pinned (or trial) commit.
 * @param {{ userAgent?: string, sha?: string, log?: (s: string) => void }} [opts]
 */
export async function loadChampionsDex(opts = {}) {
  const sha = opts.sha ?? SHOWDOWN_SHA;
  const userAgent = opts.userAgent ?? "ChampionsPokedexBuild/1.0";
  const entries = await Promise.all(
    Object.entries(SHOWDOWN_FILES).map(async ([key, path]) => [key, await fetchFile(path, sha, userAgent)]),
  );
  const text = Object.fromEntries(entries);
  return buildChampionsDex(text, sha);
}

/** Assemble the dex from already-fetched file texts (exported for offline tests). */
export function buildChampionsDex(text, sha = SHOWDOWN_SHA) {
  for (const [file, needle] of TRIPWIRES) {
    if (!text[file]?.includes(needle)) {
      throw new Error(
        `Showdown ${SHOWDOWN_FILES[file]} @ ${sha.slice(0, 10)} no longer contains \`${needle}\` — ` +
          "a rule this generator mirrors changed upstream; re-read it before bumping the SHA",
      );
    }
  }
  const parse = (key, exportName) => {
    const mod = parseDataModule(text[key], SHOWDOWN_FILES[key]);
    if (!(exportName in mod)) throw new Error(`${SHOWDOWN_FILES[key]} has no \`${exportName}\` export`);
    return mod[exportName];
  };

  const species = parse("pokedex", "Pokedex"); // the mod has no pokedex.ts: base species data
  const formatsData = parse("modFormatsData", "FormatsData"); // standalone: lists every species
  // The mod's learnsets.ts ONLY. It is standalone — one complete Champions
  // learnset per legal species/form (Floette-Eternal's `inherit` pulls event
  // data, never moves). Showdown would hand a species the mod omits its
  // mainline learnset; those species aren't Champions-legal, and leaving the
  // base file out makes "a mainline movepool sneaks in" impossible.
  const learnsets = inherit({}, parse("modLearnsets", "Learnsets"));
  const moves = inherit(parse("moves", "Moves"), parse("modMoves", "Moves"));
  const items = inherit(parse("items", "Items"), parse("modItems", "Items"));
  const abilities = inherit(parse("abilities", "Abilities"), parse("modAbilities", "Abilities"));
  // scripts.ts init(): `if (Moves[i].pp > 20) modData('Moves', i).pp = 20`.
  for (const m of Object.values(moves)) if (m.pp > 20) m.pp = 20;

  const movesText = parse("movesText", "MovesText");
  const abilitiesText = parse("abilitiesText", "AbilitiesText");
  const itemsText = parse("itemsText", "ItemsText");
  return {
    sha,
    species,
    formatsData,
    learnsets,
    moves,
    items,
    abilities,
    // Raw mod tables, for diffing what Champions changed vs mainline.
    modMoves: parse("modMoves", "Moves"),
    baseMoves: parse("moves", "Moves"),
    modItems: parse("modItems", "Items"),
    modAbilities: parse("modAbilities", "Abilities"),
    text: {
      move: (id) => resolveText(movesText[id]),
      ability: (id) => resolveText(abilitiesText[id]),
      item: (id) => resolveText(itemsText[id]),
    },
  };
}

/** Champions' in-battle PP — scripts.ts `calculatePP` on the capped base PP. */
export function championsPP(move) {
  if (move?.pp == null) return null;
  return move.noPPBoosts ? move.pp : (move.pp / 5 + 1) * 4;
}

/**
 * True when Champions' formats-data lets this species/forme into a battle —
 * Showdown's `Species` merge (`{...pokedex, ...formatsData}`), including its
 * tier fallback for a forme with no formats-data row (battle-only formes read
 * their base's row).
 */
export function isChampionsLegal(dex, id) {
  const sp = getSpecies(dex, id);
  if (!sp || sp.isNonstandard) return false;
  let fd = dex.formatsData[sp.id];
  if (!fd?.tier && !fd?.doublesTier && sp.baseSpecies !== sp.name) {
    fd = dex.formatsData[toId(sp.battleOnly ?? sp.baseSpecies)];
  }
  return !!fd && !fd.isNonstandard && (fd.tier ?? "Illegal") !== "Illegal";
}

/** True when a move/item/ability exists in Champions (no `isNonstandard` tag). */
export const isChampionsAvailable = (entry) => !!entry && !entry.isNonstandard;

/**
 * Showdown's `learnsetParent` for the champions mod (sim/dex-species.ts):
 * a forme without its own learnset falls back to its base; a pre-evolution is
 * NEVER walked (tripwired above); freely switchable formes (Rotom appliances)
 * extend their base; and prevo-less formes of an evolved species reach the
 * family's first stage (Floette-Eternal → Flabébé).
 */
function learnsetParent(dex, sp, checkingMoves) {
  if (!dex.learnsets[sp.id]?.learnset && sp.forme) return getSpecies(dex, sp.changesFrom || sp.baseSpecies);
  if (sp.prevo) return null; // champions: `if (currentMod.startsWith('champions')) return null`
  if (sp.changesFrom && sp.baseSpecies !== "Kyurem") return getSpecies(dex, sp.changesFrom);
  if (checkingMoves && sp.baseSpecies && getSpecies(dex, sp.baseSpecies)?.prevo) {
    let evo = getSpecies(dex, sp.baseSpecies);
    while (evo?.prevo) evo = getSpecies(dex, evo.prevo);
    return evo ?? null;
  }
  return null;
}

/**
 * A species record resolved like Showdown's `Species` constructor: base species,
 * forme, `battleOnly` (Megas/Primals), `changesFrom` (which form it changes
 * from — the base for a Mega, undefined for a regional forme) and the mod's
 * `isNonstandard` merged over the pokédex's.
 */
export function getSpecies(dex, nameOrId) {
  const id = toId(nameOrId);
  const raw = dex.species[id];
  if (!raw) return null;
  const fd = dex.formatsData[id] ?? {};
  const baseSpecies = raw.baseSpecies || raw.name;
  const forme = raw.forme || "";
  const isMegaOrPrimal = forme.includes("Mega") || forme === "Primal";
  const battleOnly = raw.battleOnly || (isMegaOrPrimal ? baseSpecies : undefined);
  let changesFrom = raw.changesFrom || (battleOnly !== baseSpecies ? battleOnly : baseSpecies);
  if (Array.isArray(changesFrom)) changesFrom = changesFrom[0];
  const isNonstandard = ("isNonstandard" in fd ? fd.isNonstandard : raw.isNonstandard) || null;
  return { ...raw, id, baseSpecies, forme, battleOnly, changesFrom, isNonstandard, prevo: raw.prevo || "" };
}

/** Showdown's `eggMovesOnly(child, father)` for this mod. */
function eggMovesOnly(dex, child, father) {
  if (child.baseSpecies === father?.baseSpecies) return false;
  let f = father;
  while (f) {
    if (f.name === child.name) return false;
    f = learnsetParent(dex, f, false);
  }
  return true;
}

/**
 * A species/forme's Champions movepool — Showdown's `getMovePool` (built on
 * `getFullLearnset`) for the champions mod, minus moves the mod tags
 * nonstandard (they can't be used in a Champions battle).
 * Returns the move ids plus the chain of learnset ids it read, so callers can
 * record provenance and see when a fallback branch was taken.
 */
export function championsMovePool(dex, speciesId) {
  const original = getSpecies(dex, speciesId);
  if (!original) throw new Error(`Showdown has no species "${speciesId}"`);
  const chain = [];
  const seen = new Set();
  /** @type {any} */
  let sp = original;
  while (sp?.name && !seen.has(sp.id)) {
    seen.add(sp.id);
    const ls = dex.learnsets[sp.id];
    if (ls?.learnset) {
      chain.push({ species: sp, learnset: ls.learnset });
      sp = learnsetParent(dex, sp, true);
      continue;
    }
    if ((sp.changesFrom || sp.baseSpecies) !== sp.name) {
      sp = getSpecies(dex, sp.changesFrom || sp.baseSpecies);
      continue;
    }
    if (sp.isNonstandard) break;
    if (sp.prevo && dex.learnsets[toId(sp.prevo)]?.learnset) {
      sp = getSpecies(dex, sp.prevo);
      continue;
    }
    throw new Error(`Showdown species with no learnset data: ${sp.id}`);
  }
  const moves = new Set();
  const excluded = new Set();
  let eggOnly = false;
  for (const { species, learnset } of chain) {
    if (!eggOnly) eggOnly = eggMovesOnly(dex, species, original);
    for (const [moveId, sources] of Object.entries(learnset)) {
      const ok = eggOnly
        ? sources.some((s) => s.startsWith("9E"))
        : sources.some((s) => s.startsWith("9"));
      if (!ok) continue;
      if (isChampionsAvailable(dex.moves[moveId])) moves.add(moveId);
      else excluded.add(moveId);
    }
    if (species.evoRegion) eggOnly = true;
  }
  return { moves, excluded, chain: chain.map((c) => c.species.id) };
}
