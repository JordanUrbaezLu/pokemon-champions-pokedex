import type { Metadata, Viewport } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import { OpponentTray } from "@/components/OpponentTray";
import "./globals.css";

// Manrope: smooth, rounded, and highly legible at small sizes — easy to read
// at a glance mid-battle. Geist Mono is reserved for stat/dex numerals.
const appSans = Manrope({
  variable: "--font-app-sans",
  subsets: ["latin"],
});

const appMono = Geist_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
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
  // Lock zoom so the layout stays put while a trainer taps quickly mid-battle.
  maximumScale: 1,
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
      className={`${appSans.variable} ${appMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        {/* The app is mobile-only: pin content to a phone-width column so it
            stays focused and thumb-friendly even on larger screens. */}
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background">
          {children}
          {/* The opponent dock survives every navigation — pin their team at
              preview, get back to any of them in one tap all battle long. */}
          <OpponentTray />
        </div>
      </body>
    </html>
  );
}
