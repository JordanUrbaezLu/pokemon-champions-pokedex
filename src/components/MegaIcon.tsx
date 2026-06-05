import Image from "next/image";

/**
 * Mega Evolution mark — the real emblem (transparent PNG in /public). Sizing is
 * controlled by the parent via `className`; pass a size utility like `size-5`.
 */
export function MegaIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/mega-badge.png"
      alt="Has a Mega Evolution"
      width={24}
      height={24}
      className={className}
    />
  );
}
