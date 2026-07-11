"use client";

import Link from "next/link";

/**
 * Route-level error boundary. A client render error mid-battle must never blank
 * the whole app behind Next's bare default — keep it calm and actionable:
 * retry the page, or bail back to search.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-5xl font-black text-muted">!</p>
      <p className="text-muted">Something went wrong loading this page.</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-accent px-5 py-2.5 font-bold text-white active:opacity-80"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full bg-surface-2 px-5 py-2.5 font-bold text-foreground active:opacity-80"
        >
          Search
        </Link>
      </div>
    </main>
  );
}
