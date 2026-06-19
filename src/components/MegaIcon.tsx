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
      // One tiny shared asset reused across the list — load it eagerly so iOS
      // Safari repaints it after a back navigation (native lazy leaves it blank
      // until a scroll), same fix as the roster icons.
      loading="eager"
    />
  );
}
