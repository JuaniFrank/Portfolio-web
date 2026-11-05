import type { SeriesInput } from "@/lib/monitoreo/api-schemas";
import type { TradeMarkerData } from "@/lib/monitoreo/trade-marker-data";
import type { MonitoringSeries } from "@/lib/monitoreo/types";

/**
 * Browser-side calls to the /api/activos route handlers. They return `{ error }` instead of
 * throwing (network failure, non-OK status, or an unreadable body) so callers have one
 * error path. Route handlers, unlike server actions, don't go through Next's action queue,
 * so they can't be orphaned by the History API calls the page makes to keep the URL in sync.
 */
export type ApiResult<T> = T | { error: string };

const GENERIC_ERROR = "No pudimos cargar los datos. Probá de nuevo.";

async function readJson<T>(res: Response): Promise<ApiResult<T>> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // e.g. a redirect to the HTML login page when the session expired
    return { error: res.status === 401 || res.redirected ? "Tu sesión expiró. Volvé a iniciar sesión." : GENERIC_ERROR };
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : GENERIC_ERROR;
    return { error: message };
  }
  return body as T;
}

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    return await readJson<T>(await fetch(url, { cache: "no-store", ...init }));
  } catch {
    return { error: GENERIC_ERROR };
  }
}

export function fetchSeries(input: SeriesInput): Promise<ApiResult<MonitoringSeries>> {
  const params = new URLSearchParams(
    Object.entries(input).filter((e): e is [string, string] => typeof e[1] === "string")
  );
  return request(`/api/activos/series?${params.toString()}`);
}

/** Loads (and persists) the full external history; POST because it writes to the cache. */
export function postHistory(input: SeriesInput): Promise<ApiResult<MonitoringSeries>> {
  return request("/api/activos/history", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function fetchTrades(instrumentId: string): Promise<ApiResult<TradeMarkerData>> {
  return request(`/api/activos/trades?${new URLSearchParams({ instrumentId }).toString()}`);
}
