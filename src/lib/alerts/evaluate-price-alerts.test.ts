import { describe, expect, it } from "vitest";
import { evaluatePriceAlerts } from "./evaluate-price-alerts";
import type { Notifier, NotifyResult, PriceSource, PriceTargetRepo } from "./ports";
import type { AlertTarget, PriceRequest } from "./types";

const NOW = new Date("2026-10-27T15:00:00Z");

function target(overrides: Partial<AlertTarget> = {}): AlertTarget {
  return {
    id: "t1",
    userId: "u1",
    instrumentId: "i1",
    ticker: "KO",
    symbol: "KO",
    currency: "USD",
    direction: "BELOW",
    targetPrice: 92,
    note: null,
    triggeredAt: null,
    triggeredPrice: null,
    notifiedAt: null,
    ...overrides,
  };
}

function fakeRepo(targets: AlertTarget[], applied: { triggered?: boolean; notified?: boolean } = {}) {
  const calls = { triggered: [] as Array<[string, number, Date]>, notified: [] as Array<[string, Date]> };
  const repo: PriceTargetRepo = {
    listPending: async () => targets,
    markTriggered: async (id, price, at) => {
      calls.triggered.push([id, price, at]);
      return applied.triggered ?? true;
    },
    markNotified: async (id, at) => {
      calls.notified.push([id, at]);
      return applied.notified ?? true;
    },
  };
  return { repo, calls };
}

function fakePrices(prices: Record<string, number>) {
  const requested: PriceRequest[][] = [];
  const source: PriceSource = {
    resolve: async (requests) => {
      requested.push(requests);
      return new Map(Object.entries(prices).filter(([id]) => requests.some((r) => r.instrumentId === id)));
    },
  };
  return { source, requested };
}

function fakeNotifier(result: NotifyResult | (() => never) = { status: "sent" }) {
  const messages: string[] = [];
  const notifier: Notifier = {
    send: async (message) => {
      messages.push(message);
      return typeof result === "function" ? result() : result;
    },
  };
  return { notifier, messages };
}

describe("evaluatePriceAlerts", () => {
  it("dispara, notifica y marca notifiedAt cuando el precio cumple el objetivo", async () => {
    const { repo, calls } = fakeRepo([target()]);
    const { source } = fakePrices({ i1: 91.5 });
    const { notifier, messages } = fakeNotifier();

    const summary = await evaluatePriceAlerts({ repo, prices: source, notifier, now: NOW });

    expect(calls.triggered).toEqual([["t1", 91.5, NOW]]);
    expect(calls.notified).toEqual([["t1", NOW]]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("KO");
    expect(summary).toMatchObject({ evaluated: 1, triggered: 1, notified: 1, skipped: 0, failed: 0 });
  });

  it("dispara exactamente en el límite del objetivo", async () => {
    const { repo, calls } = fakeRepo([target({ targetPrice: 92 })]);
    await evaluatePriceAlerts({ repo, prices: fakePrices({ i1: 92 }).source, notifier: fakeNotifier().notifier, now: NOW });
    expect(calls.triggered).toHaveLength(1);
  });

  it("no hace nada si el precio todavía no cumple", async () => {
    const { repo, calls } = fakeRepo([target()]);
    const { notifier, messages } = fakeNotifier();
    const summary = await evaluatePriceAlerts({ repo, prices: fakePrices({ i1: 95 }).source, notifier, now: NOW });
    expect(calls.triggered).toEqual([]);
    expect(messages).toEqual([]);
    expect(summary).toMatchObject({ evaluated: 1, triggered: 0, notified: 0 });
  });

  it("sin precio disponible no dispara y lo cuenta como faltante", async () => {
    const { repo, calls } = fakeRepo([target()]);
    const summary = await evaluatePriceAlerts({ repo, prices: fakePrices({}).source, notifier: fakeNotifier().notifier, now: NOW });
    expect(calls.triggered).toEqual([]);
    expect(summary).toMatchObject({ evaluated: 1, triggered: 0, missingPrice: 1 });
  });

  it("un objetivo ya notificado no se vuelve a avisar", async () => {
    const done = target({ triggeredAt: new Date("2026-10-26T15:00:00Z"), triggeredPrice: 90, notifiedAt: new Date("2026-10-26T15:01:00Z") });
    const { repo, calls } = fakeRepo([done]);
    const { notifier, messages } = fakeNotifier();
    const summary = await evaluatePriceAlerts({ repo, prices: fakePrices({ i1: 80 }).source, notifier, now: NOW });
    expect(messages).toEqual([]);
    expect(calls.triggered).toEqual([]);
    expect(calls.notified).toEqual([]);
    expect(summary.evaluated).toBe(0);
  });

  it("un objetivo re-armado (triggeredAt limpio) vuelve a avisar", async () => {
    // Re-armar limpia triggeredAt, triggeredPrice y notifiedAt: es un objetivo armado normal.
    const { repo, calls } = fakeRepo([target({ triggeredAt: null, triggeredPrice: null, notifiedAt: null })]);
    const { notifier, messages } = fakeNotifier();
    await evaluatePriceAlerts({ repo, prices: fakePrices({ i1: 80 }).source, notifier, now: NOW });
    expect(messages).toHaveLength(1);
    expect(calls.notified).toHaveLength(1);
  });

  it("si el disparo no se aplicó (otra corrida o un re-armado lo ganó), no avisa", async () => {
    const { repo } = fakeRepo([target()], { triggered: false });
    const { notifier, messages } = fakeNotifier();
    const summary = await evaluatePriceAlerts({ repo, prices: fakePrices({ i1: 80 }).source, notifier, now: NOW });
    expect(messages).toEqual([]);
    expect(summary).toMatchObject({ triggered: 0, notified: 0, failed: 0 });
  });

  it("si el aviso ya estaba marcado por otra corrida, no se cuenta como notificado", async () => {
    const { repo } = fakeRepo([target()], { notified: false });
    const summary = await evaluatePriceAlerts({
      repo,
      prices: fakePrices({ i1: 80 }).source,
      notifier: fakeNotifier().notifier,
      now: NOW,
    });
    expect(summary).toMatchObject({ triggered: 1, notified: 0 });
  });

  it("notificador omitido: queda disparado pero sin notifiedAt", async () => {
    const { repo, calls } = fakeRepo([target()]);
    const { notifier } = fakeNotifier({ status: "skipped", reason: "sin configurar" });
    const summary = await evaluatePriceAlerts({ repo, prices: fakePrices({ i1: 80 }).source, notifier, now: NOW });
    expect(calls.triggered).toHaveLength(1);
    expect(calls.notified).toEqual([]);
    expect(summary).toMatchObject({ triggered: 1, notified: 0, skipped: 1, failed: 0 });
  });

  it("envío fallido: queda disparado sin notifiedAt y se cuenta como fallo", async () => {
    const { repo, calls } = fakeRepo([target()]);
    const { notifier } = fakeNotifier({ status: "failed", error: "HTTP 500" });
    const summary = await evaluatePriceAlerts({ repo, prices: fakePrices({ i1: 80 }).source, notifier, now: NOW });
    expect(calls.triggered).toHaveLength(1);
    expect(calls.notified).toEqual([]);
    expect(summary).toMatchObject({ triggered: 1, notified: 0, failed: 1 });
  });

  it("un notificador que lanza se trata como fallo y no corta el resto", async () => {
    const { repo, calls } = fakeRepo([target({ id: "t1" }), target({ id: "t2", instrumentId: "i2" })]);
    const { notifier } = fakeNotifier(() => {
      throw new Error("red caída");
    });
    const summary = await evaluatePriceAlerts({ repo, prices: fakePrices({ i1: 80, i2: 80 }).source, notifier, now: NOW });
    expect(calls.triggered.map(([id]) => id)).toEqual(["t1", "t2"]);
    expect(summary.failed).toBe(2);
  });

  it("reintenta la notificación de un objetivo disparado pero sin notificar, sin volver a dispararlo", async () => {
    const pending = target({ triggeredAt: new Date("2026-10-26T15:00:00Z"), triggeredPrice: 90, notifiedAt: null });
    const { repo, calls } = fakeRepo([pending]);
    const { notifier, messages } = fakeNotifier();
    // El precio de hoy ya no cumple: igual se avisa lo que se disparó antes, con el precio guardado.
    const summary = await evaluatePriceAlerts({ repo, prices: fakePrices({ i1: 99 }).source, notifier, now: NOW });
    expect(calls.triggered).toEqual([]);
    expect(calls.notified).toEqual([["t1", NOW]]);
    expect(messages[0]).toContain("90,00");
    expect(summary).toMatchObject({ triggered: 0, notified: 1 });
  });

  it("pide un solo precio por instrumento aunque tenga varios objetivos", async () => {
    const targets = [target({ id: "a" }), target({ id: "b", direction: "ABOVE", targetPrice: 200 })];
    const { repo } = fakeRepo(targets);
    const { source, requested } = fakePrices({ i1: 80 });
    await evaluatePriceAlerts({ repo, prices: source, notifier: fakeNotifier().notifier, now: NOW });
    expect(requested[0]).toEqual([{ instrumentId: "i1", currency: "USD", symbol: "KO" }]);
  });

  it("sin objetivos pendientes no consulta precios", async () => {
    const { repo } = fakeRepo([]);
    const { source, requested } = fakePrices({});
    const summary = await evaluatePriceAlerts({ repo, prices: source, notifier: fakeNotifier().notifier, now: NOW });
    expect(requested).toEqual([]);
    expect(summary.evaluated).toBe(0);
  });
});
