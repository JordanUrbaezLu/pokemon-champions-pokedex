import { TYPE_COLORS, typeTextColor } from "@/lib/type-meta";
import { toDisplayName } from "@/lib/format";
import type { PokemonType } from "@/lib/types";

/** A type pill in the type's brand color — the app's core visual unit. */
export function TypeBadge({
  type,
  size = "md",
}: {
  type: PokemonType;
  size?: "sm" | "md" | "lg";
}) {
  const sizing =
    size === "sm"
      ? "text-[10px] px-2 py-[3px]"
      : size === "lg"
        ? "text-sm px-3.5 py-1.5"
        : "text-xs px-2.5 py-1";
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold uppercase tracking-wider ${sizing}`}
      style={{
        backgroundColor: TYPE_COLORS[type],
        color: typeTextColor(type),
      }}
    >
      {toDisplayName(type)}
    </span>
  );
}
