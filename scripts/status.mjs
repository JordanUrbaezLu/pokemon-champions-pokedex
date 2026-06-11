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

// Integrity invariants — each guards a bug this project actually hit once.
const checks = [
  ["no Tera moves anywhere (Champions has no Tera)", mons.every((p) => !p.moveSlugs.includes("tera-blast"))],
  ["Alolan Ninetales keeps Freeze-Dry (learnset-hole patch)", byName.get("ninetales-alola")?.moveSlugs.includes("freeze-dry") ?? false],
  ["Hisuian Arcanine keeps Head Smash (prevo-chain patch)", byName.get("arcanine-hisui")?.moveSlugs.includes("head-smash") ?? false],
  ["Wash Rotom doesn't carry Heat Rotom's Overheat", !(byName.get("rotom-wash")?.moveSlugs.includes("overheat") ?? true)],
  ["master bracket present with usable move data", Object.values(comp.brackets.master ?? {}).some((p) => Object.keys(p.moveUsage).length > 3)],
  ["both data files agree on generation date", dex.generatedAt === comp.meta.generatedAt],
];

console.log("");
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failed++;
}

const ageDays = dex.generatedAt
  ? Math.floor((Date.now() - new Date(dex.generatedAt).getTime()) / 86400000)
  : null;
if (ageDays != null && ageDays > 14) {
  console.log(`\n  ⚠ data is ${ageDays} days old — consider \`npm run data:all\``);
}

process.exit(failed ? 1 : 0);
