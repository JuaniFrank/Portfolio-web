# Referencia — modelo de datos (Prisma)

> Archivo: `prisma/schema.prisma` (527 líneas) · Seed: `prisma/seed.ts` ·
> Cliente generado en `src/lib/generated/prisma` (importar **siempre** desde ahí, nunca
> desde `@prisma/client`).

Este documento es la referencia completa del schema. Cada sistema documenta inline los modelos
que usa, así que probablemente solo necesites este archivo si vas a **modificar** el schema.

---

## Configuración

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../src/lib/generated/prisma"   // ← cliente fuera de node_modules
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Singleton del cliente en `src/lib/prisma.ts`, con caché en `globalThis` para sobrevivir al HMR
y logging condicionado por `NODE_ENV`.

---

## Enums

```prisma
enum CostMethod        { PPP FIFO LIFO }
enum VenueType         { EXCHANGE OTC CRYPTO BROKER_INTERNAL }
enum AssetType         { EQUITY BOND COMMODITY INDEX CRYPTO FUND CASH }

enum InstrumentType {
  CEDEAR STOCK_AR BOND_AR LETRA ON FCI
  STOCK_US ETF CRYPTO STABLECOIN CASH OPTION FUTURE
}

enum TransactionType {
  BUY SELL
  DIVIDEND_CASH DIVIDEND_STOCK
  COUPON AMORTIZATION INTEREST
  FEE TAX_WITHHOLDING
  DEPOSIT WITHDRAWAL FX_CONVERSION
  SPLIT REVERSE_SPLIT SPINOFF MERGER
  TRANSFER_IN TRANSFER_OUT ADJUSTMENT
}

enum TransactionSource { MANUAL IMPORT API }
enum ImportStatus      { PENDING PREVIEW COMMITTED REVERTED FAILED }
enum FxSource          { CCL MEP OFICIAL BLUE MAYORISTA CRYPTO BROKER }
enum MacroCode         { IPC_AR CPI_US MERVAL SP500 RIESGO_PAIS UVA CER BADLAR }
enum CorporateEventType{ CEDEAR_RATIO_CHANGE STOCK_SPLIT REVERSE_SPLIT SPINOFF MERGER TICKER_CHANGE }
enum RateType          { FIXED FLOATING }
```

### Qué enums se usan de verdad hoy

| Enum | Uso real |
|---|---|
| `InstrumentType` | Se ingestan `STOCK_AR`, `CEDEAR`, `ON`, `BOND_AR`, `LETRA`. Se **muestran** solo los 3 primeros (`TRADE_INSTRUMENT_TYPES`) |
| `TransactionType` | El importer produce BUY, SELL, DIVIDEND_CASH, COUPON, AMORTIZATION, DEPOSIT, WITHDRAWAL, TAX_WITHHOLDING, ADJUSTMENT. El resto no se genera todavía |
| `CostMethod` | Declarado en `User` y `Portfolio`, pero el cálculo real es **siempre PPP/AVCO** |
| `FxSource` | Solo se escribe `CCL` |
| `MacroCode` | Sin uso (`MacroSeries` está vacío) |
| `ImportStatus` | Solo se escribe `COMMITTED` |

---

## Catálogos

### `Currency`

```prisma
model Currency {
  code     String  @id     // "ARS", "USD", "EUR", "USDT", "BTC"
  name     String
  symbol   String?
  decimals Int     @default(2)
  isCrypto Boolean @default(false)
  isFiat   Boolean @default(true)
}
```

PK = el código. Sembrado por `prisma/seed.ts`: ARS, USD, EUR, USDT, USDC, BTC.

### `Venue`

```prisma
model Venue {
  code     String    @id   // "BYMA", "NYSE", "NASDAQ", "BINANCE"
  name     String
  country  String?
  timezone String
  type     VenueType
}
```

### `UnderlyingAsset`

```prisma
model UnderlyingAsset {
  id      String    @id @default(cuid())
  ticker  String    @unique   // canónico: "AAPL", "GGAL", "BTC"
  name    String
  type    AssetType
  sector  String?              // ← única fuente de sector para el dashboard
  country String?
  isin    String?
}
```

Es la única fuente de `sector`. Si un `Instrument` no tiene `underlyingAsset`, el dashboard
deriva un pseudo-sector del `InstrumentType` (ver `translateSector` en
`src/lib/dashboard/build.ts`).

---

## `Instrument` — la clave de todo el sistema

```prisma
model Instrument {
  id                String           @id @default(cuid())
  ticker            String
  name              String
  type              InstrumentType
  venueCode         String?
  currencyCode      String
  underlyingAssetId String?
  conversionRatio   Decimal?         @db.Decimal(20, 8)  // para CEDEARs — sin uso hoy
  isin              String?
  taxJurisdiction   String?          // "AR" | "US"
  taxExempt         Boolean          @default(false)
  active            Boolean          @default(true)

  @@unique([ticker, type, venueCode, currencyCode])
  @@index([type])
  @@index([underlyingAssetId])
}
```

### La identidad compuesta

`@@unique([ticker, type, venueCode, currencyCode])` es **la convención más importante del
repo**. Tres caminos distintos crean instrumentos y los tres deben resolver la misma fila:

| Camino | Archivo |
|---|---|
| Import de broker | `src/lib/importers/commit-import.ts` → `venueFor()` |
| Alta manual | `src/app/actions/transactions.ts` → `venueForType()` |
| Sync de catálogo | `src/lib/market/catalog-sync.ts` → `venueCode: "BYMA"` fijo |

Regla de `venueCode`:

```ts
CEDEAR | STOCK_AR | BOND_AR | LETRA | ON  →  "BYMA"
resto                                      →  null
```

> `venueForType()` y `venueFor()` son funciones **idénticas duplicadas**. Si cambiás una,
> cambiá la otra.

### Por qué `findFirst` + `create` y no `upsert`

`venueCode` es nullable y forma parte del unique compuesto. Prisma **no puede targetear `null`**
en el `where` de un `upsert` compuesto. Por eso el patrón en todo el repo es:

```ts
let inst = await prisma.instrument.findFirst({ where: identity });
if (!inst) {
  try {
    inst = await prisma.instrument.create({ data: { ...identity, ... } });
  } catch (err) {
    if (isP2002(err)) inst = await prisma.instrument.findFirst({ where: identity });
    if (!inst) throw err;
  }
}
```

### Soft delist

`catalog-sync.ts` nunca hace `delete`: marca `active: false`. `Transaction` tiene FK a
`Instrument` y el histórico debe sobrevivir aunque el símbolo se deslicite.

---

## Usuarios y portfolios

```prisma
model User {
  id                  String     @id @default(cuid())
  email               String     @unique
  passwordHash        String
  name                String?
  displayCurrencyCode String     @default("ARS")     // en sesión, sin uso en UI
  defaultCostMethod   CostMethod @default(PPP)       // en sesión, sin uso en cálculo
  timezone            String     @default("America/Argentina/Buenos_Aires")
  emailVerified       DateTime?                       // nunca se escribe
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Portfolio {
  id               String     @id @default(cuid())
  userId           String
  name             String
  description      String?
  baseCurrencyCode String     @default("ARS")
  costMethod       CostMethod @default(PPP)
  inceptionDate    DateTime   @default(now())
  isDefault        Boolean    @default(false)
  archivedAt       DateTime?
  @@index([userId])
}
```

**Portfolio por defecto:** las actions lo resuelven con
`orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]` y `archivedAt: null`.
Si no existe ninguno, `ensureManualTargets` / `ensureDefaultImportTargets` crean uno llamado
`"Principal"`.

---

## Brokers

```prisma
model Broker {
  id      String  @id @default(cuid())
  code    String  @unique   // "BALANZ", "IOL", "PPI", "MANUAL"
  name    String
  enabled Boolean @default(false)   // ← gate de imports
}

model BrokerAccount {
  id                String    @id @default(cuid())
  userId            String
  brokerId          String
  name              String
  currencyCode      String
  externalAccountId String?
  archivedAt        DateTime?
  @@index([userId])
  @@index([brokerId])
}
```

`Broker.enabled` es el gate real del import: `commitImportAction` corta con
`if (!broker?.enabled)`. Un broker nuevo necesita entrada en `BROKER_IMPORTERS`
(`src/lib/importers/registry.ts`) **y** fila en DB con `enabled: true`.

El broker `MANUAL` se crea con `upsert` en la primera alta manual.

---

## `Transaction` — el modelo central

```prisma
model Transaction {
  id                    String            @id @default(cuid())
  portfolioId           String
  brokerAccountId       String
  instrumentId          String?           // null en DEPOSIT/WITHDRAWAL/ADJUSTMENT
  type                  TransactionType
  tradeDate             DateTime
  settlementDate        DateTime?
  quantity              Decimal           @db.Decimal(20, 8)
  price                 Decimal           @db.Decimal(20, 8)
  currencyCode          String
  grossAmount           Decimal           @db.Decimal(20, 8)
  fees                  Decimal           @default(0) @db.Decimal(20, 8)
  taxes                 Decimal           @default(0) @db.Decimal(20, 8)
  marketRights          Decimal           @default(0) @db.Decimal(20, 8)
  netAmount             Decimal           @db.Decimal(20, 8)
  fxRateToBaseCurrency  Decimal?          @db.Decimal(20, 8)
  brokerFxRate          Decimal?          @db.Decimal(20, 8)
  counterpartyAccountId String?
  notes                 String?
  source                TransactionSource @default(MANUAL)
  importBatchId         String?
  externalId            String?
  idempotencyHash       String
  idempotencyVersion    Int               @default(1)

  @@unique([idempotencyHash, idempotencyVersion])
  @@index([portfolioId, tradeDate])
  @@index([instrumentId])
  @@index([brokerAccountId])
}
```

### Campos con semántica no obvia

| Campo | Qué es de verdad |
|---|---|
| `netAmount` | En BUY: `gross + fees + taxes` (plata que sale). En SELL: `gross − fees − taxes` (plata que entra). **Es el campo que usa el cálculo de posiciones**, no `grossAmount` |
| `fxRateToBaseCurrency` | Cuántas unidades de `portfolio.baseCurrency` vale 1 unidad de `currencyCode`. Declarado, **sin uso hoy** |
| `brokerFxRate` | **NO es una cotización.** Es el código de especie del broker: Balanz exporta `"Dólares C.V. 7000"` y guardamos `7000`. Se persiste solo por trazabilidad. Documentado en `src/lib/dividends/aggregate.ts` |
| `marketRights` | Derechos de mercado. Declarado, el importer no lo llena |
| `counterpartyAccountId` | El otro lado de un `FX_CONVERSION` o `TRANSFER`. Sin uso |
| `idempotencyHash` | Ver abajo |

### Idempotencia

`@@unique([idempotencyHash, idempotencyVersion])`.

**Imports** (`src/lib/importers/idempotency.ts`) — SHA-256 de:

```
brokerAccountId | externalId | tradeDate | type | ticker | currencyCode | quantity | netAmount | rowNumber
```

`rowNumber` está incluido a propósito: permite dos filas idénticas dentro del mismo archivo
(operaciones repetidas legítimas) pero bloquea reimportar el mismo archivo.

**Alta manual** — `sha256("manual|<userId>|<randomUUID()>")`, siempre único.
El antiduplicado solo aplica a imports.

---

## `ImportBatch`

```prisma
model ImportBatch {
  id           String       @id @default(cuid())
  userId       String
  brokerId     String
  fileName     String
  fileHash     String        // SHA-256 del buffer del archivo
  status       ImportStatus  @default(PENDING)
  rowsTotal    Int @default(0)
  rowsImported Int @default(0)
  rowsSkipped  Int @default(0)
  rawSummary   Json?
  createdAt    DateTime @default(now())
  committedAt  DateTime?
  @@index([userId])
}
```

Hoy solo se escribe con `status: COMMITTED`. Los estados `PREVIEW` / `REVERTED` / `FAILED`
existen para un flujo de reversión que **no está implementado**.

---

## Precios y FX

```prisma
model PriceCache {
  id           String     @id @default(cuid())
  instrumentId String
  datetime     DateTime
  open  Decimal? @db.Decimal(20, 8)
  high  Decimal? @db.Decimal(20, 8)
  low   Decimal? @db.Decimal(20, 8)
  close Decimal  @db.Decimal(20, 8)
  volume Decimal? @db.Decimal(20, 8)
  source String                       // "yahoo" | "data912"
  @@unique([instrumentId, datetime, source])
  @@index([instrumentId, datetime])
}

model FxRate {
  id                String   @id @default(cuid())
  date              DateTime
  baseCurrencyCode  String   // "USD"
  quoteCurrencyCode String   // "ARS" → 1 USD = mid ARS
  source            FxSource
  buy  Decimal? @db.Decimal(20, 8)
  sell Decimal? @db.Decimal(20, 8)
  mid  Decimal  @db.Decimal(20, 8)
  @@unique([date, baseCurrencyCode, quoteCurrencyCode, source])
  @@index([baseCurrencyCode, quoteCurrencyCode, date])
}
```

> ⚠️ **Gotcha del upsert de `PriceCache`.** El unique incluye `datetime`. Si escribís con
> `new Date()` crudo, cada llamada genera una clave nueva, el `WHERE` nunca matchea, siempre
> entra por la rama `create` y la tabla crece sin límite. `data912.ts` lo resuelve truncando
> al bucket de revalidación:
>
> ```ts
> const bucketMs = REVALIDATE_SECONDS * 1000;
> const bucketedNow = new Date(Math.floor(Date.now() / bucketMs) * bucketMs);
> ```
>
> `quotes.ts` usa el `regularMarketTime` que devuelve Yahoo, que ya es estable.

`FxRate` solo se escribe desde `resolveCclRate()` (`src/lib/market/ccl-rate.ts`), con
`source: CCL` y `date` = medianoche UTC de hoy.

---

## `CorporateEvent`

```prisma
model CorporateEvent {
  id              String             @id @default(cuid())
  instrumentId    String
  eventType       CorporateEventType
  effectiveDate   DateTime
  numerator       Decimal            @db.Decimal(20, 8)
  denominator     Decimal            @db.Decimal(20, 8)
  notes           String?
  appliedAt       DateTime           @default(now())
  createdByUserId String

  @@unique([instrumentId, effectiveDate, eventType])
  @@index([instrumentId])
  @@index([createdByUserId])
}
```

El unique compuesto evita registrar dos veces el mismo evento. La action captura P2002 y
devuelve *"Ya existe un evento de este tipo para el instrumento en esa fecha."*

**El evento no muta transacciones.** El ajuste se aplica en tiempo de agregación
(`src/lib/events/apply.ts`), así que borrar el evento revierte todo.

---

## `BondTerms`

```prisma
model BondTerms {
  id                    String     @id @default(cuid())
  instrumentId          String     @unique      // 1:1 con Instrument
  faceValue             Decimal    @db.Decimal(20, 8)
  currencyCode          String
  rateType              RateType
  couponRate            Decimal    @db.Decimal(20, 8)   // fracción decimal: 0.085 = 8.5%
  couponFrequencyMonths Int
  issueDate             DateTime
  maturityDate          DateTime
  amortizationSchedule  Json       // [{ date: ISO, principalPct: number }] — suma 100
  dayCountConvention    String     @default("ACT/365")
  @@index([instrumentId])
}
```

`amortizationSchedule` es JSON sin validación a nivel DB. La invariante *"los `principalPct`
suman 100 ±0.01"* la impone `validateBondTermsInput()` en `src/app/actions/bond-terms.ts`
y también el form en el cliente.

`couponRate` es **fracción decimal**, no porcentaje. La validación rechaza `> 1` con un mensaje
explícito.

---

## Modelos declarados sin uso

| Modelo | Intención | Estado |
|---|---|---|
| `PortfolioSnapshot` | Histórico EOD con `positions` JSON, `twrSinceInception`, aportes netos | Nadie escribe |
| `MacroSeries` | Series macro (IPC, MERVAL, riesgo país, UVA, CER, BADLAR) | Vacío |
| `Tag` / `TransactionTag` | Etiquetas por usuario | **Se leen** en `getTransactionsPageDataAction` (columna "Etiquetas") pero ninguna UI las escribe. El fallback muestra el código del broker |
| `AuditLog` | Auditoría de acciones | Nadie escribe |

`PortfolioSnapshot` es la base natural para TWR/MWR y series temporales
(`src/lib/calculations/performance.ts` es el stub reservado para eso).

---

## Seed

`prisma/seed.ts` (380 líneas) crea:

1. **Currencies** — ARS, USD, EUR, USDT, USDC, BTC.
2. **Venues** — BYMA, NYSE, NASDAQ, BINANCE.
3. **Brokers** — BALANZ (enabled), y los demás deshabilitados.
4. **UnderlyingAssets** + **Instruments** de ejemplo.
5. **Usuario demo** — `demo@demo.com` / `demo1234` con portfolio "Principal".

```bash
pnpm run db:seed
```

`prisma/scripts/fix-eac4o-currency.ts` es un script one-off de corrección de datos, no parte
del seed.

---

## Cómo modificar el schema

```bash
# 1. editar prisma/schema.prisma
pnpm run db:push        # desarrollo — sin migración versionada
pnpm run db:migrate     # producción — crea migración
pnpm run db:generate    # regenerar el cliente en src/lib/generated/prisma
```

**Guías:**

- Preferí cambios **aditivos**. `BondTerms` se agregó así: modelo nuevo + relación opcional,
  cero impacto en lo existente.
- Todo campo monetario nuevo: `Decimal @db.Decimal(20, 8)`.
- Todo campo con `@@unique` que incluya un nullable: recordá que no podés usarlo en un `upsert`.
- Si agregás un `InstrumentType`, revisá quién lo tiene que mostrar:
  `TRADE_INSTRUMENT_TYPES` (`src/lib/transactions/types.ts`), `marketSegmentFor()` y
  `translateSector()` (`src/lib/dashboard/build.ts`), `mapBalanzInstrumentType()`
  (`src/lib/importers/balanz.ts`), `INSTRUMENT_TYPE_LABELS` (`src/lib/imports/filters.ts`).
- Si agregás un `TransactionType`, revisá `TRANSACTION_TYPE_LABELS`
  (`src/lib/imports/filters.ts`) — es un `Record` exhaustivo y **no compila** si falta una clave.
