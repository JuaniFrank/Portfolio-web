"""Adaptador de metadatos de Yahoo Finance para el catálogo de instrumentos.

Lifted verbatim from ``scripts/yahoo_catalog.py`` (T-15). The leading
underscore in this module's filename keeps Vercel from routing it directly as
a function — only ``api/yahoo-metadata.py`` is publicly routable.

El símbolo de catálogo siempre es el canónico de Data912 (por ejemplo, ``GGAL``).
Este módulo resuelve por separado el identificador del proveedor (``GGAL.BA``)
y devuelve solamente campos que el catálogo puede persistir.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict


InstrumentType = Literal[
    "STOCK_AR", "CEDEAR", "STOCK_US", "ON", "BOND_AR", "LETRA"
]
YAHOO_SUPPORTED_TYPES = {"STOCK_AR", "CEDEAR", "STOCK_US"}


class CatalogMetadata(TypedDict, total=False):
    symbol: str
    instrumentType: str
    provider: str
    providerSymbol: str
    name: str
    currencyCode: str
    taxJurisdiction: str
    sector: str
    industry: str
    website: str


def normalize_symbol(symbol: str) -> str:
    """Return the canonical, provider-independent catalog symbol."""
    return symbol.strip().upper()


def resolve_yahoo_symbol(symbol: str, instrument_type: str, origin: str = "data912") -> str | None:
    """Resolve a canonical symbol to Yahoo's convention, or ``None`` if Yahoo
    must not be consulted for this instrument.

    ``origin`` is explicit to leave room for a future universe whose symbols do
    not follow Data912/BYMA conventions.
    """
    canonical = normalize_symbol(symbol)
    if not canonical or instrument_type not in YAHOO_SUPPORTED_TYPES:
        return None
    if instrument_type in {"STOCK_AR", "CEDEAR"}:
        return canonical if canonical.endswith(".BA") else f"{canonical}.BA"
    if instrument_type == "STOCK_US":
        return canonical
    return None


def enrich_catalog_instrument(
    symbol: str, instrument_type: str, origin: str = "data912"
) -> CatalogMetadata | None:
    """Fetch and normalize Yahoo metadata for one catalog instrument.

    Returns ``None`` for fixed income, which deliberately has no Yahoo
    fallback. Network/provider errors are allowed to propagate so callers can
    decide whether enrichment should be retried without losing the catalog row.
    """
    canonical = normalize_symbol(symbol)
    provider_symbol = resolve_yahoo_symbol(canonical, instrument_type, origin)
    if provider_symbol is None:
        return None

    import yfinance as yf

    console.log("enrich_catalog_instrument", canonical, provider_symbol)

    info: dict[str, Any] = yf.Ticker(provider_symbol).info or {}
    name = info.get("longName") or info.get("shortName") or canonical
    currency = info.get("currency")
    currency_code = currency.upper() if isinstance(currency, str) and currency.strip() else "ARS"

    return {
        "symbol": canonical,
        "instrumentType": instrument_type,
        "provider": "yahoo",
        "providerSymbol": provider_symbol,
        "name": name,
        "currencyCode": currency_code,
        # The trade is issued/listed in Argentina even when a CEDEAR represents
        # a foreign underlying; its tax treatment can be refined later.
        "taxJurisdiction": "AR",
        "sector": info.get("sector") if isinstance(info.get("sector"), str) else "",
        "industry": info.get("industry") if isinstance(info.get("industry"), str) else "",
        "website": info.get("website") if isinstance(info.get("website"), str) else "",
    }
