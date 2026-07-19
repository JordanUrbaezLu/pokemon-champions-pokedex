import type { Metadata } from "next";
import { Calc } from "@/components/Calc";
import { buildCalcIndex } from "@/lib/calc-data";

export const metadata: Metadata = {
  title: "Battle Calc · Champions Pokédex",
  description:
    "A Pokémon Champions damage calculator — pick any two mons, tune their Stat-Point sets, and see who KOs whom. Doubles, Lv 50, no Terastallization. Fully offline.",
};

// The index is built once at build time (every page is prerendered / zero
// runtime calls). Passed as props so the ~2.4 MB raw dataset stays server-side
// and only the trimmed calc projection ships to the client — on this route only.
export default function CalcPage() {
  const index = buildCalcIndex("master");
  return <Calc index={index} />;
}
