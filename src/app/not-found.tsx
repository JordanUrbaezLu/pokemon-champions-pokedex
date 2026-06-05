import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-5xl font-black text-muted">404</p>
      <p className="text-muted">
        That Pokémon isn’t in the Champions roster.
      </p>
      <Link
        href="/"
        className="rounded-full bg-accent px-5 py-2.5 font-bold text-white active:opacity-80"
      >
        Back to search
      </Link>
    </main>
  );
}
