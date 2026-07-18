import type { Metadata, Viewport } from "next";
import { Manrope, Geist_Mono, Chakra_Petch } from "next/font/google";
import { OpponentTray } from "@/components/OpponentTray";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import "./globals.css";

// Manrope: smooth, rounded, and highly legible at small sizes — easy to read
// at a glance mid-battle. It carries ALL body copy, labels and chips. Geist Mono
// is reserved for stat/dex numerals (numbers win the hierarchy).
const appSans = Manrope({
  variable: "--font-app-sans",
  subsets: ["latin"],
});

const appMono = Geist_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
});

// Chakra Petch: a squared, chamfered "tactical HUD" face — the app is an
// in-battle scouting console, not a friendly encyclopedia, and this is the
// personality that says so. Used with restraint: the wordmark, the opponent's
// name in the hero, and the section readout labels ONLY. Never body copy — its
// job is identity, Manrope's is legibility.
const appDisplay = Chakra_Petch({
  variable: "--font-app-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Champions Pokédex",
  description:
    "A fast, battle-ready Pokédex for Pokémon Champions. Look up any opponent and read their type matchups, stats, and abilities in real time.",
  applicationName: "Champions Pokédex",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Champions Pokédex",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-to-zoom is intentionally left enabled: locking it (maximumScale: 1)
  // is a WCAG 1.4.4 failure and blocks trainers who need to enlarge small text
  // mid-battle. The layout already holds at any zoom level.
  themeColor: "#0b0f14",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${appSans.variable} ${appMono.variable} ${appDisplay.variable} h-full antialiased`}
    >
      <head>
        {/* Sprites come from this CDN; shaving the handshake makes the first
            artwork paint noticeably sooner on cellular. */}
        <link rel="preconnect" href="https://raw.githubusercontent.com" />
      </head>
      <body className="min-h-full font-sans">
        {/* The app is mobile-only: pin content to a phone-width column so it
            stays focused and thumb-friendly even on larger screens. */}
        {/* Transparent column so the body's fixed ambient glow shows through
            the glass panels. */}
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
          {children}
          {/* The opponent dock survives every navigation — pin their team at
              preview, get back to any of them in one tap all battle long. */}
          <OpponentTray />
        </div>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
