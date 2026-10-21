"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors in the root layout. It replaces the root layout while
 * active, so it must render its own <html>/<body> and cannot rely on the app's providers
 * or Tailwind theme: styles are inline on purpose.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error.digest ?? "no-digest", error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#09090b",
          color: "#fafafa",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Algo salió mal</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#a1a1aa" }}>
            La aplicación tuvo un error inesperado. Probá de nuevo en unos segundos.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 12, fontFamily: "monospace", color: "#71717a" }}>
              Código: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              marginTop: 8,
              padding: "8px 16px",
              borderRadius: 6,
              border: 0,
              background: "#fafafa",
              color: "#09090b",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
