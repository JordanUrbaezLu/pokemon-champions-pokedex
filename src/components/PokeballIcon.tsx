/** A crisp, theme-aware Pokéball mark rendered inline as SVG (no image asset). */
export function PokeballIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Pokéball"
    >
      <defs>
        <clipPath id="pokeball-clip">
          <circle cx="50" cy="50" r="46" />
        </clipPath>
      </defs>
      <g clipPath="url(#pokeball-clip)">
        <rect x="0" y="0" width="100" height="50" fill="#ff5350" />
        <rect x="0" y="50" width="100" height="50" fill="#f4f6f8" />
        <rect x="0" y="43" width="100" height="14" fill="#11161d" />
      </g>
      <circle cx="50" cy="50" r="46" fill="none" stroke="#11161d" strokeWidth="5" />
      <circle cx="50" cy="50" r="16" fill="#11161d" />
      <circle cx="50" cy="50" r="10" fill="#f4f6f8" />
      <circle cx="50" cy="50" r="4.5" fill="#11161d" />
    </svg>
  );
}
