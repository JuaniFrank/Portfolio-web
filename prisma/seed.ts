import {
  AssetType,
  InstrumentType,
  Prisma,
  PrismaClient,
  VenueType,
} from "../src/lib/generated/prisma";
import { RECOMMENDED_EVENTS } from "../src/lib/events/recommended";

const prisma = new PrismaClient();

async function main() {
  // 1. Currencies
  const currencies = [
    // --- Originales ---
    { code: "USD", name: "US Dollar", symbol: "US$", decimals: 2, isCrypto: false, isFiat: true },
    { code: "EUR", name: "Euro", symbol: "€", decimals: 2, isCrypto: false, isFiat: true },
    { code: "ARS", name: "Peso Argentino", symbol: "$ars", decimals: 2, isCrypto: false, isFiat: true },
    { code: "MXN", name: "Peso Mexicano", symbol: "$mxn", decimals: 2, isCrypto: false, isFiat: true },
    { code: "BRL", name: "Real", symbol: "R$", decimals: 2, isCrypto: false, isFiat: true },
    { code: "USDT", name: "Tether", symbol: "USDT", decimals: 6, isCrypto: true, isFiat: false },
    { code: "USDC", name: "USD Coin", symbol: "USDC", decimals: 6, isCrypto: true, isFiat: false },
    { code: "BTC", name: "Bitcoin", symbol: "₿", decimals: 8, isCrypto: true, isFiat: false },
    { code: "ETH", name: "Ethereum", symbol: "Ξ", decimals: 18, isCrypto: true, isFiat: false },

    // --- Monedas de países con CEDEARs en BYMA ---
    { code: "GBP", name: "Libra Esterlina", symbol: "£", decimals: 2, isCrypto: false, isFiat: true },
    { code: "CHF", name: "Franco Suizo", symbol: "CHF", decimals: 2, isCrypto: false, isFiat: true },
    { code: "JPY", name: "Yen Japonés", symbol: "¥", decimals: 0, isCrypto: false, isFiat: true },
    { code: "CNY", name: "Yuan Chino", symbol: "CN¥", decimals: 2, isCrypto: false, isFiat: true },
    { code: "INR", name: "Rupia India", symbol: "₹", decimals: 2, isCrypto: false, isFiat: true },
    { code: "TWD", name: "Nuevo Dólar Taiwanés", symbol: "NT$", decimals: 2, isCrypto: false, isFiat: true },
    { code: "ZAR", name: "Rand Sudafricano", symbol: "R", decimals: 2, isCrypto: false, isFiat: true },
    { code: "CAD", name: "Dólar Canadiense", symbol: "CA$", decimals: 2, isCrypto: false, isFiat: true },

    // --- Extras (plazas grandes / LatAm regional) ---
    { code: "AUD", name: "Dólar Australiano", symbol: "A$", decimals: 2, isCrypto: false, isFiat: true },
    { code: "HKD", name: "Dólar de Hong Kong", symbol: "HK$", decimals: 2, isCrypto: false, isFiat: true },
    { code: "SGD", name: "Dólar de Singapur", symbol: "S$", decimals: 2, isCrypto: false, isFiat: true },
    { code: "CLP", name: "Peso Chileno", symbol: "CLP$", decimals: 0, isCrypto: false, isFiat: true },
    { code: "COP", name: "Peso Colombiano", symbol: "COL$", decimals: 2, isCrypto: false, isFiat: true },
    { code: "PEN", name: "Sol Peruano", symbol: "S/", decimals: 2, isCrypto: false, isFiat: true },
    { code: "UYU", name: "Peso Uruguayo", symbol: "$U", decimals: 2, isCrypto: false, isFiat: true },
  ];

  for (const c of currencies) {
    await prisma.currency.upsert({
      where: { code: c.code },
      create: c,
      update: c,
    });
  }

  // 2. Venues
  const venues = [
    {
      code: "BYMA",
      name: "Bolsas y Mercados Argentinos",
      country: "AR",
      timezone: "America/Argentina/Buenos_Aires",
      type: VenueType.EXCHANGE,
    },
    {
      code: "MAE",
      name: "Mercado Abierto Electrónico",
      country: "AR",
      timezone: "America/Argentina/Buenos_Aires",
      type: VenueType.OTC,
    },
    {
      code: "NYSE",
      name: "New York Stock Exchange",
      country: "US",
      timezone: "America/New_York",
      type: VenueType.EXCHANGE,
    },
    {
      code: "NASDAQ",
      name: "NASDAQ",
      country: "US",
      timezone: "America/New_York",
      type: VenueType.EXCHANGE,
    },
    {
      code: "BINANCE",
      name: "Binance",
      country: null,
      timezone: "UTC",
      type: VenueType.CRYPTO,
    },
    {
      code: "AMEX",
      name: "NYSE American (AMEX)",
      country: "US",
      timezone: "America/New_York",
      type: VenueType.EXCHANGE,
    },
    {
      code: "CBOE",
      name: "Cboe Global Markets",
      country: "US",
      timezone: "America/Chicago",
      type: VenueType.EXCHANGE,
    },
    {
      code: "B3",
      name: "B3 Brasil",
      country: "BR",
      timezone: "America/Sao_Paulo",
      type: VenueType.EXCHANGE,
    },
    {
      code: "LSE",
      name: "London Stock Exchange",
      country: "GB",
      timezone: "Europe/London",
      type: VenueType.EXCHANGE,
    },
    {
      code: "BCBA",
      name: "Bolsa de Comercio de Buenos Aires",
      country: "AR",
      timezone: "America/Argentina/Buenos_Aires",
      type: VenueType.EXCHANGE,
    },
  ];

  for (const v of venues) {
    await prisma.venue.upsert({
      where: { code: v.code },
      create: v,
      update: v,
    });
  }

  // 3. Underlying assets
  const underlyingRows: Array<{
    ticker: string;
    name: string;
    type: AssetType;
    sector: string | null;
    country: string | null;
  }> = [
    { ticker: "AAPL", name: "Apple Inc.", type: AssetType.EQUITY, sector: "Technology", country: "US" },
    { ticker: "MSFT", name: "Microsoft Corp.", type: AssetType.EQUITY, sector: "Technology", country: "US" },
    { ticker: "GOOGL", name: "Alphabet Inc.", type: AssetType.EQUITY, sector: "Technology", country: "US" },
    {
      ticker: "AMZN",
      name: "Amazon.com Inc.",
      type: AssetType.EQUITY,
      sector: "Consumer Discretionary",
      country: "US",
    },
    {
      ticker: "TSLA",
      name: "Tesla Inc.",
      type: AssetType.EQUITY,
      sector: "Consumer Discretionary",
      country: "US",
    },
    { ticker: "NVDA", name: "NVIDIA Corp.", type: AssetType.EQUITY, sector: "Technology", country: "US" },
    {
      ticker: "KO",
      name: "The Coca-Cola Company",
      type: AssetType.EQUITY,
      sector: "Consumer Staples",
      country: "US",
    },
    {
      ticker: "JPM",
      name: "JPMorgan Chase & Co.",
      type: AssetType.EQUITY,
      sector: "Financials",
      country: "US",
    },
    {
      ticker: "MELI",
      name: "MercadoLibre Inc.",
      type: AssetType.EQUITY,
      sector: "Consumer Discretionary",
      country: "US",
    },
    {
      ticker: "BRK.B",
      name: "Berkshire Hathaway B",
      type: AssetType.EQUITY,
      sector: "Financials",
      country: "US",
    },
    {
      ticker: "GGAL",
      name: "Grupo Financiero Galicia",
      type: AssetType.EQUITY,
      sector: "Financials",
      country: "AR",
    },
    { ticker: "YPFD", name: "YPF S.A.", type: AssetType.EQUITY, sector: "Energy", country: "AR" },
    { ticker: "PAMP", name: "Pampa Energía", type: AssetType.EQUITY, sector: "Utilities", country: "AR" },
    { ticker: "BMA", name: "Banco Macro", type: AssetType.EQUITY, sector: "Financials", country: "AR" },
    {
      ticker: "ALUA",
      name: "Aluar Aluminio Argentino",
      type: AssetType.EQUITY,
      sector: "Materials",
      country: "AR",
    },
    {
      ticker: "TXAR",
      name: "Ternium Argentina",
      type: AssetType.EQUITY,
      sector: "Materials",
      country: "AR",
    },
    {
      ticker: "COME",
      name: "Sociedad Comercial del Plata",
      type: AssetType.EQUITY,
      sector: "Industrials",
      country: "AR",
    },
    {
      ticker: "CRES",
      name: "Cresud",
      type: AssetType.EQUITY,
      sector: "Consumer Staples",
      country: "AR",
    },
    { ticker: "LOMA", name: "Loma Negra", type: AssetType.EQUITY, sector: "Materials", country: "AR" },
    {
      ticker: "MIRG",
      name: "Mirgor",
      type: AssetType.EQUITY,
      sector: "Consumer Discretionary",
      country: "AR",
    },
    {
      ticker: "SUPV",
      name: "Grupo Supervielle",
      type: AssetType.EQUITY,
      sector: "Financials",
      country: "AR",
    },
    {
      ticker: "TGSU2",
      name: "Transportadora de Gas del Sur",
      type: AssetType.EQUITY,
      sector: "Utilities",
      country: "AR",
    },
  ];

  const underlyingByTicker = new Map<string, { id: string }>();
  for (const u of underlyingRows) {
    const row = await prisma.underlyingAsset.upsert({
      where: { ticker: u.ticker },
      create: u,
      update: { name: u.name, type: u.type, sector: u.sector, country: u.country },
    });
    underlyingByTicker.set(u.ticker, { id: row.id });
  }

  // 4. Brokers
  const brokers = [
    { code: "BALANZ", name: "Balanz", enabled: true },
    { code: "IOL", name: "Invertir Online", enabled: false },
    { code: "BULL_MARKET", name: "Bull Market Brokers", enabled: false },
    { code: "PPI", name: "Portfolio Personal Inversiones", enabled: false },
    { code: "IBKR", name: "Interactive Brokers", enabled: false },
    { code: "COCOS", name: "Cocos Capital", enabled: false },
    { code: "IEB", name: "IEB", enabled: false },
  ];

  for (const b of brokers) {
    await prisma.broker.upsert({
      where: { code: b.code },
      create: b,
      update: { name: b.name, enabled: b.enabled },
    });
  }

  // 5. Instruments — CEDEARs (USA underlyings)
  for (const u of underlyingRows.filter((x) => x.country === "US")) {
    const ua = underlyingByTicker.get(u.ticker);
    if (!ua) continue;
    await prisma.instrument.upsert({
      where: {
        ticker_type_venueCode_currencyCode: {
          ticker: u.ticker,
          type: InstrumentType.CEDEAR,
          venueCode: "BYMA",
          currencyCode: "ARS",
        },
      },
      create: {
        ticker: u.ticker,
        name: `${u.name} (CEDEAR)`,
        type: InstrumentType.CEDEAR,
        venueCode: "BYMA",
        currencyCode: "ARS",
        underlyingAssetId: ua.id,
        // TODO: ajustar ratio real por ticker cuando exista fuente canónica
        conversionRatio: new Prisma.Decimal(10),
        taxJurisdiction: "AR",
      },
      update: {
        name: `${u.name} (CEDEAR)`,
        underlyingAssetId: ua.id,
        conversionRatio: new Prisma.Decimal(10),
        taxJurisdiction: "AR",
      },
    });
  }

  // Acciones AR
  for (const u of underlyingRows.filter((x) => x.country === "AR")) {
    const ua = underlyingByTicker.get(u.ticker);
    if (!ua) continue;
    await prisma.instrument.upsert({
      where: {
        ticker_type_venueCode_currencyCode: {
          ticker: u.ticker,
          type: InstrumentType.STOCK_AR,
          venueCode: "BYMA",
          currencyCode: "ARS",
        },
      },
      create: {
        ticker: u.ticker,
        name: u.name,
        type: InstrumentType.STOCK_AR,
        venueCode: "BYMA",
        currencyCode: "ARS",
        underlyingAssetId: ua.id,
        taxJurisdiction: "AR",
      },
      update: {
        name: u.name,
        underlyingAssetId: ua.id,
        taxJurisdiction: "AR",
      },
    });
  }

  async function upsertCashInstrument(input: {
    ticker: string;
    name: string;
    currencyCode: string;
  }) {
    const existing = await prisma.instrument.findFirst({
      where: {
        ticker: input.ticker,
        type: InstrumentType.CASH,
        currencyCode: input.currencyCode,
        venueCode: null,
      },
    });

    if (existing) {
      await prisma.instrument.update({
        where: { id: existing.id },
        data: { name: input.name },
      });
      return;
    }

    await prisma.instrument.create({
      data: {
        ticker: input.ticker,
        name: input.name,
        type: InstrumentType.CASH,
        venueCode: null,
        currencyCode: input.currencyCode,
      },
    });
  }

  await upsertCashInstrument({ ticker: "CASH-ARS", name: "Efectivo ARS", currencyCode: "ARS" });
  await upsertCashInstrument({ ticker: "CASH-USD", name: "Efectivo USD", currencyCode: "USD" });

  // 6. Known public corporate actions (FR-15). Loaded from RECOMMENDED_EVENTS
  // — the single source shared with resolveApplicableRecommendations, so the
  // recommendation card and the seeded fact can never disagree. createdByUserId
  // is null: this is a global fact about the instrument, not a user record
  // (schema comment on CorporateEvent.createdByUserId).
  for (const rec of RECOMMENDED_EVENTS) {
    const instrument = await prisma.instrument.upsert({
      where: {
        ticker_type_venueCode_currencyCode: {
          ticker: rec.ticker,
          type: rec.instrumentType,
          venueCode: "BYMA",
          currencyCode: "ARS",
        },
      },
      create: {
        ticker: rec.ticker,
        name: `${rec.ticker} (${rec.instrumentType})`,
        type: rec.instrumentType,
        venueCode: "BYMA",
        currencyCode: "ARS",
        taxJurisdiction: "AR",
      },
      update: {},
    });

    await prisma.corporateEvent.upsert({
      where: {
        instrumentId_effectiveDate_eventType: {
          instrumentId: instrument.id,
          effectiveDate: new Date(rec.effectiveDate),
          eventType: rec.eventType,
        },
      },
      create: {
        instrumentId: instrument.id,
        eventType: rec.eventType,
        effectiveDate: new Date(rec.effectiveDate),
        numerator: new Prisma.Decimal(rec.numerator),
        denominator: new Prisma.Decimal(rec.denominator),
        notes: rec.notes,
        createdByUserId: null,
      },
      update: {},
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
