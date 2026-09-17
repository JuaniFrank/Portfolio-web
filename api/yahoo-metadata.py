"""Vercel file-based Python function: POST /api/yahoo-metadata.

Two modes, sharing auth, batch limit, and response envelope:
  - "metadata" (default, §10.3): enrichment shape for STOCK_AR/CEDEAR/STOCK_US.
  - "currency" (§10.3b, AD-12): the currency oracle — ARS/USD/not-listed/unavailable.

Convention: Vercel's file-based Python runtime routes a class named `handler`
subclassing `BaseHTTPRequestHandler` (design §16 item 2 — verify against the
live runtime docs before merge; the preview-deploy gate, T-19/T-65, is the
catch-all for a wrong convention).

Auth: shared secret via `X-Internal-Token`, compared with `hmac.compare_digest`
(constant-time). A missing `INTERNAL_FUNCTION_SECRET` in the process fails
closed (401) — a missing secret must never mean "no auth required".
"""

from __future__ import annotations

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from typing import Any

# Vercel imports this entrypoint by absolute path without putting its own
# directory on sys.path, so a bare `import _yahoo_catalog` raises
# ModuleNotFoundError at load time and the function 500s before serving a single
# request. The sibling is bundled — only unreachable — so make it importable.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _yahoo_catalog import enrich_catalog_instrument, normalize_symbol, resolve_yahoo_symbol

BATCH_LIMIT = 25
QUOTE_ENDPOINT = "https://query2.finance.yahoo.com/v7/finance/quote"


def _unauthorized(req: Any) -> None:
    _respond(req, 401, {"error": "unauthorized"})


def _respond(req: Any, status: int, body: dict[str, Any]) -> None:
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req.send_response(status)
    req.send_header("Content-Type", "application/json; charset=utf-8")
    req.send_header("Content-Length", str(len(payload)))
    req.end_headers()
    req.wfile.write(payload)


def _is_authorized(req: Any) -> bool:
    secret = os.environ.get("INTERNAL_FUNCTION_SECRET")
    if not secret:
        # Fail closed: an unset secret must never be interpreted as "no auth
        # required".
        return False
    token = req.headers.get("X-Internal-Token")
    if not token:
        return False
    return hmac.compare_digest(token, secret)


def _verdict_from_quote(canonical: str, quote: dict[str, Any] | None) -> dict[str, Any]:
    """Map one symbol's slot in the batch response to an AD-12 verdict."""
    if quote is None:
        # Yahoo omits symbols it does not list — evidence of absence, which is
        # what the caller's ratio-only fallback needs (measured: NOEXISTE9Z.BA).
        return {"symbol": canonical, "ok": True, "listed": False, "currency": None}

    currency = quote.get("currency")
    if not isinstance(currency, str) or not currency.strip():
        # Present but asserting no currency (`quoteType: NONE`, e.g. AL30.BA):
        # indistinguishable from absent for this oracle's purposes.
        return {"symbol": canonical, "ok": True, "listed": False, "currency": None}

    code = currency.strip().upper()
    if code not in {"ARS", "USD"}:
        # An unexpected venue currency is not evidence to act on — never a
        # passthrough.
        return {"symbol": canonical, "ok": False, "error": f"unexpected currency {code}"}

    return {"symbol": canonical, "ok": True, "listed": True, "currency": code}


def _currency_verdicts(items: list[tuple[str, str]]) -> list[dict[str, Any]]:
    """AD-12 oracle for a whole batch in ONE Yahoo call.

    Resolving each symbol through `Ticker(...).info` cost a request per symbol
    (several, really — `.info` pulls quoteSummary modules nobody reads here),
    which put the ~1,100-symbol Yahoo-covered universe far past the caller's
    per-request timeout and its overall budget. The batch quote endpoint answers
    every symbol of a batch at once; `YfData` owns the cookie/crumb handshake
    and the re-handshake on 401, which is the whole reason yfinance is here.

    A failed call is no evidence at all, so its symbols fail closed rather than
    being reported as unlisted — the caller must never guess a currency.
    """
    verdicts: list[dict[str, Any]] = []
    pending: dict[str, list[int]] = {}

    for symbol, instrument_type in items:
        canonical = normalize_symbol(symbol)
        provider_symbol = resolve_yahoo_symbol(canonical, instrument_type)
        if provider_symbol is None:
            # Not a Yahoo-supported type (ON/BOND_AR/LETRA): no call, no cost.
            verdicts.append({"symbol": canonical, "ok": True, "listed": False, "currency": None})
            continue
        verdicts.append({"symbol": canonical, "ok": False, "error": "not resolved"})
        pending.setdefault(provider_symbol, []).append(len(verdicts) - 1)

    if not pending:
        return verdicts

    try:
        from yfinance.data import YfData

        payload = (
            YfData().get_raw_json(QUOTE_ENDPOINT, params={"symbols": ",".join(pending)}) or {}
        )
        quotes = payload.get("quoteResponse", {}).get("result") or []
    except Exception as error:  # noqa: BLE001 - any yfinance/network failure
        for indexes in pending.values():
            for index in indexes:
                verdicts[index] = {
                    "symbol": verdicts[index]["symbol"],
                    "ok": False,
                    "error": str(error),
                }
        return verdicts

    by_symbol = {q.get("symbol"): q for q in quotes if isinstance(q, dict)}
    for provider_symbol, indexes in pending.items():
        for index in indexes:
            verdicts[index] = _verdict_from_quote(
                verdicts[index]["symbol"], by_symbol.get(provider_symbol)
            )
    return verdicts


def _metadata_result(symbol: str, instrument_type: str) -> dict[str, Any]:
    try:
        data = enrich_catalog_instrument(symbol, instrument_type)
    except Exception as error:  # noqa: BLE001 - per-item failure, never fails the batch
        return {"symbol": normalize_symbol(symbol), "ok": False, "error": str(error)}
    # data is None for an unsupported type (ON/BOND_AR/LETRA) or a symbol Yahoo
    # does not cover — "no Yahoo opinion", not an error (§10.3).
    return {"symbol": normalize_symbol(symbol), "ok": True, "data": data}


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - Vercel/BaseHTTPRequestHandler convention
        _respond(self, 405, {"error": "method not allowed"})

    def do_POST(self) -> None:  # noqa: N802 - Vercel/BaseHTTPRequestHandler convention
        if not _is_authorized(self):
            _unauthorized(self)
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length > 0 else b""
            body = json.loads(raw or b"{}")
        except (ValueError, json.JSONDecodeError):
            _respond(self, 400, {"error": "malformed body"})
            return

        if not isinstance(body, dict):
            _respond(self, 400, {"error": "malformed body"})
            return

        items = body.get("items")
        if not isinstance(items, list):
            _respond(self, 400, {"error": "malformed body"})
            return
        if len(items) > BATCH_LIMIT:
            _respond(self, 400, {"error": "batch too large"})
            return

        mode = body.get("mode", "metadata")

        # Parsed up front so the currency oracle can resolve the batch in one
        # call while each result still lands back on its own request slot.
        parsed: list[tuple[str, str] | None] = []
        for item in items:
            if not isinstance(item, dict):
                parsed.append(None)
                continue
            symbol = item.get("symbol")
            instrument_type = item.get("type")
            if not isinstance(symbol, str) or not isinstance(instrument_type, str):
                parsed.append(None)
                continue
            parsed.append((symbol, instrument_type))

        malformed = {"symbol": "", "ok": False, "error": "malformed item"}
        results: list[dict[str, Any]] = []

        if mode == "currency":
            verdicts = iter(_currency_verdicts([p for p in parsed if p is not None]))
            results = [dict(malformed) if p is None else next(verdicts) for p in parsed]
        else:
            results = [
                dict(malformed) if p is None else _metadata_result(p[0], p[1]) for p in parsed
            ]

        _respond(self, 200, {"results": results})
