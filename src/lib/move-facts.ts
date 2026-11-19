/**
 * The short battle-fact chips on a move's sheet ("+2 Atk", "30% Burn",
 * "Always crits", "Hits 2–5×"), derived from the move's mechanics. Pure, so the
 * wording is unit-tested (move-facts.test.ts); MoveModal renders the list.
 * Client code: it must not import damage.ts (see `alwaysCrits` on MoveSummary).
 */
import { toDisplayName } from "./format";
import type { MoveSummary } from "./types";

const STAT_SHORT: Record<string, string> = {
  attack: "Atk",
  defense: "Def",
  "special-attack": "SpA",
  "special-defense": "SpD",
  speed: "Spe",
  accuracy: "Acc",
  evasion: "Eva",
};

/** Concise battle facts derived from the move's mechanics. */
export function moveFacts(move: MoveSummary): string[] {
  const facts: string[] = [];
  // A secondary stat change (e.g. Crunch's 20% to drop Defense) carries a
  // chance; a self-boost (Swords Dance) is guaranteed (statChance 0).
  const chancePrefix =
    move.statChance > 0 && move.statChance < 100 ? `${move.statChance}% ` : "";
  for (const sc of move.statChanges) {
    const sign = sc.change > 0 ? "+" : "";
    const stat = Object.hasOwn(STAT_SHORT, sc.stat) ? STAT_SHORT[sc.stat] : toDisplayName(sc.stat);
    facts.push(`${chancePrefix}${sign}${sc.change} ${stat}`);
  }
  if (move.ailment) {
    facts.push(
      `${move.ailmentChance > 0 ? `${move.ailmentChance}% ` : ""}${toDisplayName(move.ailment)}`,
    );
  }
  if (move.flinchChance > 0) facts.push(`${move.flinchChance}% flinch`);
  if (move.drain > 0) facts.push(`Drains ${move.drain}%`);
  if (move.drain < 0) facts.push(`${-move.drain}% recoil`);
  if (move.healing > 0) facts.push(`Heals ${move.healing}% HP`);
  // The damage engine's own list (damage.ts alwaysCrits, stamped on by pokedex.ts):
  // PokeAPI's critRate reads 6 ("high") for Frost Breath / Storm Throw and 0 for
  // Flower Trick, so the sheet said "High crit rate" for a guaranteed crit and
  // nothing at all for Flower Trick.
  if (move.alwaysCrits) facts.push("Always crits");
  else if (move.critRate > 0) facts.push("High crit rate");
  if (move.maxHits && move.maxHits > 1) {
    facts.push(
      move.minHits === move.maxHits
        ? `Hits ${move.maxHits}×`
        : `Hits ${move.minHits}–${move.maxHits}×`,
    );
  }
  return facts;
}
