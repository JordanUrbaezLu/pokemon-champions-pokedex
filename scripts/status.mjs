// @ts-check
/**
 * One-command project context: what data is baked, how fresh it is, and
 * whether the known integrity invariants still hold. Run this at the start
 * of any working session (`npm run status`) instead of re-deriving state.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

const dex = read("src/data/generated/pokemon.json");
const comp = read("src/data/generated/competitive.json");

const mons = dex.pokemon;
const byName = new Map(mons.map((p) => [p.name, p]));

console.log("Champions Pokédex — data status\n");
console.log(`  roster: ${mons.length} Pokémon · ${Object.keys(dex.moves).length} moves · generated ${dex.generatedAt ?? "?"}`);
console.log(`  ladder: ${comp.meta.format} · ${comp.meta.month} · ${comp.meta.battles.toLocaleString()} battles · generated ${comp.meta.generatedAt ?? "?"}`);
for (const [bracket, profiles] of Object.entries(comp.brackets)) {
  const benched = Object.values(profiles).filter((p) => p.benchmarks?.length).length;
  console.log(
    `  bracket ${bracket} (“${comp.meta.bracketLabels?.[bracket] ?? bracket}”): ${Object.keys(profiles).length} profiles` +
      (benched ? ` · ${benched} with KO benchmarks` : ""),
  );
}

// --- Description completeness ----------------------------------------------
// Nothing the app renders may open to a blank sheet or be un-tappable. These
// guard the "opened a move/item and there was no description" class of bug for
// CURRENT and FUTURE data — a new move/item/ability that ships without a
// description (or an item with no detail) turns this red instead of slipping by.
// "Blank" is stricter than empty: a description that's whitespace, a known junk
// stub ("null", "N/A", "-", "?"), or under 3 non-space chars is as useless to a
// trainer as none at all, so the guards treat it as a gap too.
const JUNK_DESC = /^(null|undefined|none|n\/?a|tbd|-+|\.+|\?+)$/i;
const blank = (s) => {
  const t = String(s ?? "").trim();
  return !t || t.length < 3 || JUNK_DESC.test(t);
};
const moveIndex = dex.moves ?? {};

// Moves whose sheet would render no description (both effect fields empty).
const movesNoDesc = Object.values(moveIndex).filter((m) => blank(m.effect) && blank(m.shortEffect));

// Every move slug the app references must resolve in the shared move index.
const referencedMoves = new Set();
for (const p of mons) for (const s of p.moveSlugs ?? []) referencedMoves.add(s);
for (const b of Object.values(comp.brackets ?? {})) {
  for (const pr of Object.values(b)) {
    for (const s of Object.keys(pr.moveUsage ?? {})) referencedMoves.add(s);
    for (const t of pr.setupThreats ?? []) if (t.slug) referencedMoves.add(t.slug);
    for (const bm of pr.benchmarks ?? []) if (bm.move) referencedMoves.add(bm.move);
  }
}
const orphanMoves = [...referencedMoves].filter((s) => !moveIndex[s]);

// Every ability the app shows (base + every form) must carry effect text.
const abilNoDesc = [];
for (const p of mons) {
  // A mon that ships with NO base abilities renders an empty "Abilities" section
  // — [].every() is vacuously true, so guard the length explicitly (as forms do).
  if (!(p.abilities?.length)) abilNoDesc.push(`${p.name} (no abilities)`);
  for (const a of p.abilities ?? []) if (blank(a.shortEffect)) abilNoDesc.push(`${p.name}:${a.displayName}`);
  for (const f of p.forms ?? []) {
    if (!(f.abilities?.length)) abilNoDesc.push(`${f.key}:(no abilities)`);
    for (const a of f.abilities ?? []) if (blank(a.shortEffect)) abilNoDesc.push(`${f.key}:${a.displayName}`);
  }
}

// Every item shown in "Common Items" must be tappable (non-null slug) AND
// resolve to an itemIndex entry that has a description.
const itemIndex = comp.itemIndex ?? {};
const itemGaps = new Set();
for (const b of Object.values(comp.brackets ?? {})) {
  for (const pr of Object.values(b)) {
    for (const it of pr.items ?? []) {
      if (!it.slug) itemGaps.add(`${it.displayName} (no slug → not tappable)`);
      else if (!itemIndex[it.slug]) itemGaps.add(`${it.displayName} (no detail)`);
      else if (blank(itemIndex[it.slug].effect) && blank(itemIndex[it.slug].shortEffect))
        itemGaps.add(`${it.displayName} (blank description)`);
    }
  }
}
const sample = (arr) => [...arr].slice(0, 8).join(", ") + (([...arr].length > 8) ? ` …(+${[...arr].length - 8})` : "");

// --- Coverage floors -------------------------------------------------------
// A regulation rotation can quietly change how Smogon names species (a new
// suffix, a slugify drift), collapsing the name-match so almost no profile
// attaches. The per-description checks still pass (a few profiles keep moves),
// so without a coverage floor a near-empty dataset would ship green. These turn
// a collapse — and a total KO-benchmark wipeout — red.
const hasAnyData = (p, b) =>
  [p.name, ...(p.forms ?? []).map((f) => f.key)].some((k) => b?.[k]);
const coveredAll = mons.filter((p) => hasAnyData(p, comp.brackets.all)).length;
const coverageFloor = mons.length - 25; // ~full today; trips on a match collapse
const benchedMaster = Object.values(comp.brackets.master ?? {}).filter(
  (p) => p.benchmarks?.length,
).length;

// Integrity invariants — each guards a bug this project actually hit once.
const checks = [
  ["no Tera moves anywhere (Champions has no Tera)", mons.every((p) => !p.moveSlugs.includes("tera-blast"))],
  ["Alolan Ninetales keeps Freeze-Dry (learnset-hole patch)", byName.get("ninetales-alola")?.moveSlugs.includes("freeze-dry") ?? false],
  ["Hisuian Arcanine keeps Head Smash (prevo-chain patch)", byName.get("arcanine-hisui")?.moveSlugs.includes("head-smash") ?? false],
  ["Wash Rotom doesn't carry Heat Rotom's Overheat", !(byName.get("rotom-wash")?.moveSlugs.includes("overheat") ?? true)],
  ["master bracket present with usable move data", Object.values(comp.brackets.master ?? {}).some((p) => Object.keys(p.moveUsage).length > 3)],
  ["both data files agree on generation date", dex.generatedAt === comp.meta.generatedAt],
  // Every Mega/Primal form must carry its ability — PokeAPI serves some
  // Champions-original Megas ability-less, and a Mega's ability is its single
  // most battle-defining fact (Mega Mawile's Huge Power, Mega Eelektross's Eelevate).
  ["every battle form carries an ability", mons.every((p) => (p.forms ?? []).every((f) => f.abilities?.length > 0 && f.abilities.every((a) => a.shortEffect)))],
  // Newcomers (no ladder data yet) are flagged so the NEW badge + filter work.
  ["new-to-Champions mons are flagged isNew", mons.some((p) => p.isNew)],
  // Ladder coverage floors — catch a silent name-matching collapse / benchmark wipeout.
  [`ladder coverage intact (≥${coverageFloor} mons have all-ranks data)`, coveredAll >= coverageFloor, `only ${coveredAll}/${mons.length} mons have any all-ranks data`],
  ["master bracket has KO benchmarks baked", benchedMaster >= 40, `only ${benchedMaster} master profiles carry benchmarks`],
  // --- no blank/un-tappable sheets, current or future ---
  [`every move shows a description (${Object.keys(moveIndex).length} moves)`, movesNoDesc.length === 0, `${movesNoDesc.length} blank: ${sample(movesNoDesc.map((m) => m.name))}`],
  ["every referenced move resolves in the move index", orphanMoves.length === 0, `${orphanMoves.length} orphans: ${sample(orphanMoves)}`],
  ["every ability (base + form) has effect text", abilNoDesc.length === 0, `${abilNoDesc.length} blank: ${sample(abilNoDesc)}`],
  ["every shown item is tappable with a description", itemGaps.size === 0, `${itemGaps.size} gaps: ${sample(itemGaps)}`],
];

console.log("");
let failed = 0;
for (const [label, ok, detail] of checks) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    failed++;
    if (detail) console.log(`      ↳ ${detail}`);
  }
}

const ageDays = dex.generatedAt
  ? Math.floor((Date.now() - new Date(dex.generatedAt).getTime()) / 86400000)
  : null;
if (ageDays != null && ageDays > 14) {
  console.log(`\n  ⚠ data is ${ageDays} days old — consider \`npm run data:all\``);
}

process.exit(failed ? 1 : 0);
