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


def _currency_verdict(symbol: str, instrument_type: str) -> dict[str, Any]:
    """AD-12 oracle for one symbol. Distinguishes a genuine Yahoo 404
    (evidence of absence — the ratio-only fallback applies) from a transport
    failure (no evidence at all — the caller must fail closed, never guess).
    """
    canonical = normalize_symbol(symbol)
    provider_symbol = resolve_yahoo_symbol(canonical, instrument_type)
    if provider_symbol is None:
        # Not a Yahoo-supported type (BOND_AR/LETRA, or any other type this
        # oracle does not cover) — treated as "not listed": ratio-only path.
        return {"symbol": canonical, "ok": True, "listed": False, "currency": None}

    import yfinance as yf

    try:
        info: dict[str, Any] = yf.Ticker(provider_symbol).info or {}
    except Exception as error:  # noqa: BLE001 - any yfinance/network failure
        return {"symbol": canonical, "ok": False, "error": str(error)}

    if not info:
        # yfinance returns an empty/near-empty dict for a symbol Yahoo does
        # not list (e.g. AL30.BA), rather than raising — this IS the 404 case.
        return {"symbol": canonical, "ok": True, "listed": False, "currency": None}

    currency = info.get("currency")
    if not isinstance(currency, str) or currency.strip().upper() not in {"ARS", "USD"}:
        # Anything other than ARS/USD (missing, or an unexpected venue
        # currency) is not evidence to act on — never a passthrough.
        return {"symbol": canonical, "ok": False, "error": "unexpected or missing currency"}

    return {"symbol": canonical, "ok": True, "listed": True, "currency": currency.strip().upper()}


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

        results: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                results.append({"symbol": "", "ok": False, "error": "malformed item"})
                continue
            symbol = item.get("symbol")
            instrument_type = item.get("type")
            if not isinstance(symbol, str) or not isinstance(instrument_type, str):
                results.append({"symbol": "", "ok": False, "error": "malformed item"})
                continue

            if mode == "currency":
                results.append(_currency_verdict(symbol, instrument_type))
            else:
                results.append(_metadata_result(symbol, instrument_type))

        _respond(self, 200, {"results": results})
