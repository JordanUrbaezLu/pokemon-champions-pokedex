"use client";

/**
 * Last-resort boundary for an error thrown in the root layout itself. It
 * replaces the layout, so it must render its own <html>/<body> and can't rely
 * on globals.css — inline styles keep it self-contained.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          background: "#0b0f14",
          color: "#f4f6f8",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 24,
            textAlign: "center",
          }}
        >
          <p style={{ color: "#93a1b0" }}>The app hit an unexpected error.</p>
          <button
            type="button"
            onClick={reset}
            style={{
              borderRadius: 999,
              background: "#ff5350",
              color: "#fff",
              fontWeight: 700,
              padding: "10px 20px",
              border: 0,
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
