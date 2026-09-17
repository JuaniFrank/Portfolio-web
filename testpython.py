"""Consulta datos de una acción argentina en Yahoo Finance.

Ejemplo:
    python test_yahoo_byma.py HAVA
    python test_yahoo_byma.py HAVA.BA
"""

from __future__ import annotations

import argparse
import json
import sys


def byma_ticker(symbol: str) -> str:
    """Normaliza un símbolo de BYMA al formato que usa Yahoo Finance."""
    symbol = symbol.strip().upper()
    return symbol if symbol.endswith(".BA") else f"{symbol}.BA"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Muestra nombre, sector e industria desde Yahoo Finance."
    )
    parser.add_argument("symbol", nargs="?", default="HAVA", help="Ej.: HAVA, OEST o FERR")
    args = parser.parse_args()

    try:
        import yfinance as yf
    except ImportError:
        print("Falta yfinance. Instalalo con: pip install --upgrade yfinance", file=sys.stderr)
        return 1

    ticker = byma_ticker(args.symbol)
    print(f"Consultando {ticker}...")

    try:
        info = yf.Ticker(ticker).info
    except Exception as error:
        print(f"No se pudo consultar Yahoo Finance: {error}", file=sys.stderr)
        return 2

    if not info:
        print("Yahoo Finance no devolvió información para este símbolo.", file=sys.stderr)
        return 3

    result = {
        "ticker": ticker,
        "nombre": info.get("longName") or info.get("shortName"),
        "sector": info.get("sector"),
        "industria": info.get("industry"),
        "sitio_web": info.get("website"),
        "descripcion": info.get("longBusnessSummary") or info.get("shortBusnessSummary"),
        "info": info,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())




""" EXAMPLE:
Consultando PAMP.BA...
{
  "ticker": "PAMP.BA",
  "nombre": "Pampa Energía S.A.",
  "sector": "Industrials",
  "industria": "Conglomerates",
  "sitio_web": "https://ri.pampa.com/en",
  "descripcion": null,
  "info": {
    "address1": "Pampa EnergIa Building",
    "address2": "MaipU 1",
    "city": "Buenos Aires",
    "zip": "C1084ABA",
    "country": "Argentina",
    "phone": "54 11 4344 6000",
    "website": "https://ri.pampa.com/en",
    "industry": "Conglomerates",
    "industryKey": "conglomerates",
    "industryDisp": "Conglomerates",
    "sector": "Industrials",
    "sectorKey": "industrials",
    "sectorDisp": "Industrials",
    "longBusinessSummary": "Pampa Energía S.A. operates as an integrated power company in Argentina. The company operates through Oil and Gas; Generation; Petrochemicals; and Holding, Transportation and Others segments. It generates electricity through thermal plants, hydroelectric plants, and wind farms with a 5,472 megawatt (MW) installed capacity. The company also explores for and produces oil and gas in the provinces of Neuquén and Río Negro. In addition, it produces petrochemicals, such as styrene, synthetic rubber, and polystyrene. Further, the company operates and maintains a 22,445 km high-voltage electricity transmission network in Argentina. Additionally, it holds a concession for the transportation of natural gas with 9,248 km of gas pipelines in the center, west, and south of Argentina; and processes and sells natural gas liquids in Bahía Blanca in the Province of Buenos Aires, as well as offers related advisory services. Pampa Energía S.A. was formerly known as Pampa Holding S.A. and changed its name to Pampa Energía S.A. in September 2008. The company was incorporated in 1945 and is based in Buenos Aires, Argentina.",
    "companyOfficers": [
      {
        "maxAge": 1,
        "name": "Mr. Marcos Marcelo Mindlin",
        "age": 61,
        "title": "Chairman of the Board",
        "yearBorn": 1964,
        "exercisedValue": 0,
        "unexercisedValue": 0
      },
      {
        "maxAge": 1,
        "name": "Mr. Gustavo  Mariani CFA",
        "age": 55,
        "title": "CEO, Executive VP & Vice Chairman",
        "yearBorn": 1970,
        "exercisedValue": 0,
        "unexercisedValue": 0
      },
      {
        "maxAge": 1,
        "name": "Mr. Adolfo  Zuberbuhler",
        "age": 47,
        "title": "CFO & Executive Director of Finances",
        "yearBorn": 1978,
        "exercisedValue": 0,
        "unexercisedValue": 0
      },
      {
        "maxAge": 1,
        "name": "Mr. Mauricio Leonardo Penta",
        "age": 49,
        "title": "Executive Director of Administration, IT & Supply",
        "yearBorn": 1976,
        "exercisedValue": 0,
        "unexercisedValue": 0
      },
      {
        "maxAge": 1,
        "name": "Ms. Lida  Wang",
        "title": "Head of Investor Relations & Sustainability",
        "exercisedValue": 0,
        "unexercisedValue": 0
      },
      {
        "maxAge": 1,
        "name": "Ms. Maria Carolina Sigwald",
        "age": 58,
        "title": "Executive Director of Legal Affairs",
        "yearBorn": 1967,
        "exercisedValue": 0,
        "unexercisedValue": 0
      },
      {
        "maxAge": 1,
        "name": "Ms. Mariana  De La Fuente",
        "age": 57,
        "title": "Director of Human Resources",
        "yearBorn": 1968,
        "exercisedValue": 0,
        "unexercisedValue": 0
      },
      {
        "maxAge": 1,
        "name": "Mr. Ricardo Alejandro Torres",
        "age": 67,
        "title": "Executive VP & Director",
        "yearBorn": 1958,
        "exercisedValue": 0,
        "unexercisedValue": 0
      },
      {
        "maxAge": 1,
        "name": "Mr. Damian Miguel Mindlin",
        "age": 59,
        "title": "Executive VP & Director",
        "yearBorn": 1966,
        "exercisedValue": 0,
        "unexercisedValue": 0
      },
      {
        "maxAge": 1,
        "name": "Mr. Horacio Jorge Tomas Turri",
        "age": 64,
        "title": "Executive Director of Exploration & Production",
        "yearBorn": 1961,
        "exercisedValue": 0,
        "unexercisedValue": 0
      }
    ],
    "executiveTeam": [],
    "maxAge": 86400,
    "priceHint": 2,
    "previousClose": 5535.0,
    "open": 5540.0,
    "dayLow": 5480.0,
    "dayHigh": 5640.0,
    "regularMarketPreviousClose": 5535.0,
    "regularMarketOpen": 5540.0,
    "regularMarketDayLow": 5480.0,
    "regularMarketDayHigh": 5640.0,
    "exDividendDate": 1300665600,
    "payoutRatio": 0.0,
    "beta": -0.237,
    "trailingPE": 8.091372,
    "forwardPE": 6.6937313,
    "volume": 1397343,
    "regularMarketVolume": 1397343,
    "averageVolume": 969173,
    "averageVolume10days": 958020,
    "averageDailyVolume10Day": 958020,
    "bid": 5545.0,
    "ask": 5550.0,
    "bidSize": 0,
    "askSize": 0,
    "marketCap": 7424122028032,
    "nonDilutedMarketCap": 7417421219880,
    "fiftyTwoWeekLow": 3412.5,
    "fiftyTwoWeekHigh": 5750.0,
    "allTimeHigh": 5750.0,
    "allTimeLow": 0.1,
    "fulldayPrice": 5540.0,
    "fulldayChange": 5.0,
    "fulldayChangePercent": 0.0009033424,
    "priceToSalesTrailing12Months": 3071.627,
    "fiftyDayAverage": 5285.9,
    "twoHundredDayAverage": 5083.3623,
    "trailingAnnualDividendRate": 0.0,
    "trailingAnnualDividendYield": 0.0,
    "currency": "ARS",
    "tradeable": false,
    "enterpriseValue": 7331205087232,
    "profitMargins": 0.23583001,
    "floatShares": 618326769,
    "sharesOutstanding": 1340094168,
    "heldPercentInsiders": 0.21854,
    "heldPercentInstitutions": 0.3233,
    "impliedSharesOutstanding": 1340094168,
    "bookValue": 4591.252,
    "priceToBook": 1.2066425,
    "lastFiscalYearEnd": 1767139200,
    "nextFiscalYearEnd": 1798675200,
    "mostRecentQuarter": 1782777600,
    "earningsQuarterlyGrowth": 3.3,
    "netIncomeToCommon": 570000000,
    "trailingEps": 684.68,
    "forwardEps": 827.64,
    "pegRatio": 0.59,
    "enterpriseToRevenue": 3033.184,
    "enterpriseToEbitda": 7827.132,
    "52WeekChange": 0.5216495,
    "SandP52WeekChange": 0.15336108,
    "lastDividendValue": 0.01378,
    "lastDividendDate": 1300665600,
    "quoteType": "EQUITY",
    "currentPrice": 5540.0,
    "targetHighPrice": 12300.0,
    "targetLowPrice": 6500.0,
    "targetMeanPrice": 8700.0,
    "targetMedianPrice": 7300.0,
    "recommendationKey": "none",
    "numberOfAnalystOpinions": 3,
    "totalCash": 1280999936,
    "totalCashPerShare": 0.968,
    "ebitda": 936640000,
    "totalDebt": 2627000064,
    "quickRatio": 2.888,
    "currentRatio": 3.641,
    "totalRevenue": 2416999936,
    "debtToEquity": 65.025,
    "revenuePerShare": 1.783,
    "returnOnAssets": 0.042140003,
    "returnOnEquity": 0.15264,
    "grossProfits": 808640000,
    "freeCashflow": -509724992,
    "operatingCashflow": 612000000,
    "earningsGrowth": 3.333,
    "revenueGrowth": 0.535,
    "grossMargins": 0.33456,
    "ebitdaMargins": 0.38752,
    "operatingMargins": 0.25603,
    "financialCurrency": "USD",
    "symbol": "PAMP.BA",
    "language": "en-US",
    "region": "US",
    "typeDisp": "Equity",
    "quoteSourceName": "Delayed Quote",
    "triggerable": false,
    "customPriceAlertConfidence": "LOW",
    "shortName": "PAMPA ENERGIA S.A.",
    "longName": "Pampa Energía S.A.",
    "hasPrePostMarketData": false,
    "firstTradeDateMilliseconds": 1073484000000,
    "regularMarketChange": 5.0,
    "regularMarketDayRange": "5480.0 - 5640.0",
    "fullExchangeName": "Buenos Aires",
    "averageDailyVolume3Month": 969173,
    "fiftyTwoWeekLowChange": 2127.5,
    "fiftyTwoWeekLowChangePercent": 0.62344325,
    "fiftyTwoWeekRange": "3412.5 - 5750.0",
    "fiftyTwoWeekHighChange": -210.0,
    "fiftyTwoWeekHighChangePercent": -0.03652174,
    "fiftyTwoWeekChangePercent": 52.164948,
    "earningsTimestamp": 1793649600,
    "earningsTimestampStart": 1793649600,
    "earningsTimestampEnd": 1793649600,
    "earningsCallTimestampStart": 1785938400,
    "earningsCallTimestampEnd": 1785938400,
    "isEarningsDateEstimate": false,
    "epsTrailingTwelveMonths": 684.68,
    "epsForward": 827.64,
    "epsCurrentYear": 666.63,
    "priceEpsCurrentYear": 8.310457,
    "fiftyDayAverageChange": 254.1001,
    "fiftyDayAverageChangePercent": 0.048071302,
    "twoHundredDayAverageChange": 456.6377,
    "twoHundredDayAverageChangePercent": 0.089829855,
    "sourceInterval": 20,
    "exchangeDataDelayedBy": 20,
    "cryptoTradeable": false,
    "exchange": "BUE",
    "messageBoardId": "finmb_880369",
    "exchangeTimezoneName": "America/Argentina/Buenos_Aires",
    "exchangeTimezoneShortName": "ART",
    "gmtOffSetMilliseconds": -10800000,
    "market": "ar_market",
    "esgPopulated": false,
    "regularMarketChangePercent": 0.09033424,
    "regularMarketPrice": 5540.0,
    "marketState": "POSTPOST",
    "corporateActions": [],
    "regularMarketTime": 1789502399,
    "trailingPegRatio": null
  }
} """