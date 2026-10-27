import { describe, expect, it } from "vitest";
import { createTelegramNotifier } from "./telegram";

function fakeFetch(response: { ok: boolean; status: number } | Error) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return { ok: response.ok, status: response.status } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("createTelegramNotifier", () => {
  it("sin token o sin chat id omite el envío sin llamar a la red", async () => {
    const { impl, calls } = fakeFetch({ ok: true, status: 200 });
    const noToken = createTelegramNotifier({ TELEGRAM_CHAT_ID: "1" }, impl);
    const noChat = createTelegramNotifier({ TELEGRAM_BOT_TOKEN: "abc" }, impl);
    expect((await noToken.send("hola")).status).toBe("skipped");
    expect((await noChat.send("hola")).status).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("envía el mensaje al endpoint sendMessage del bot", async () => {
    const { impl, calls } = fakeFetch({ ok: true, status: 200 });
    const notifier = createTelegramNotifier({ TELEGRAM_BOT_TOKEN: "abc", TELEGRAM_CHAT_ID: "42" }, impl);
    expect(await notifier.send("hola")).toEqual({ status: "sent" });
    expect(calls[0]?.url).toBe("https://api.telegram.org/botabc/sendMessage");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ chat_id: "42", text: "hola" });
  });

  it("una respuesta HTTP de error es un envío fallido (sin exponer el token)", async () => {
    const { impl } = fakeFetch({ ok: false, status: 400 });
    const notifier = createTelegramNotifier({ TELEGRAM_BOT_TOKEN: "secret-token", TELEGRAM_CHAT_ID: "42" }, impl);
    const result = await notifier.send("hola");
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("un error de red es un envío fallido, no una excepción", async () => {
    const { impl } = fakeFetch(new Error("ECONNRESET"));
    const notifier = createTelegramNotifier({ TELEGRAM_BOT_TOKEN: "abc", TELEGRAM_CHAT_ID: "42" }, impl);
    expect((await notifier.send("hola")).status).toBe("failed");
  });

  it("pasa una señal de timeout al fetch", async () => {
    const { impl, calls } = fakeFetch({ ok: true, status: 200 });
    const notifier = createTelegramNotifier({ TELEGRAM_BOT_TOKEN: "abc", TELEGRAM_CHAT_ID: "42" }, impl);
    await notifier.send("hola");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("un timeout (TimeoutError) es un envío fallido, no una excepción", async () => {
    const timeout = new DOMException("The operation timed out", "TimeoutError");
    const { impl } = fakeFetch(timeout as unknown as Error);
    const notifier = createTelegramNotifier({ TELEGRAM_BOT_TOKEN: "abc", TELEGRAM_CHAT_ID: "42" }, impl);
    const result = await notifier.send("hola");
    expect(result.status).toBe("failed");
  });

  it("un error cuyo mensaje contiene el token no lo filtra en el resultado", async () => {
    const { impl } = fakeFetch(
      new Error("request to https://api.telegram.org/botsecret-token/sendMessage failed")
    );
    const notifier = createTelegramNotifier({ TELEGRAM_BOT_TOKEN: "secret-token", TELEGRAM_CHAT_ID: "42" }, impl);
    const result = await notifier.send("hola");
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
});
