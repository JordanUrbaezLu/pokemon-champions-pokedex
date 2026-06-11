import type { MetadataRoute } from "next";
import { getRosterEntries } from "@/lib/pokedex";

export default function manifest(): MetadataRoute.Manifest {
  // App shortcuts (long-press the home-screen icon): jump straight to the
  // top threats — the mons you're most likely to be staring down.
  const top = [...getRosterEntries()]
    .sort((a, b) => (b.usage.master ?? -1) - (a.usage.master ?? -1))
    .slice(0, 3);

  return {
    name: "Champions Pokédex",
    short_name: "Pokédex",
    description: "A fast, battle-ready Pokédex for Pokémon Champions doubles.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0f14",
    theme_color: "#0b0f14",
    // Reopening from the home screen mid-battle must NOT re-navigate away
    // from the opponent page being read.
    launch_handler: { client_mode: "focus-existing" },
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: top.map((p) => ({
      name: p.displayName,
      url: `/pokemon/${p.name}`,
      icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    })),
  };
}
