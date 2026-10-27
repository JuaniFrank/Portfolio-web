/**
 * Notificador por Telegram (Bot API, `sendMessage`).
 *
 * Variables: `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`. Si falta alguna, el canal no está
 * configurado y el resultado es `skipped` (no un error): la app funciona igual y los
 * objetivos disparados quedan pendientes de aviso. Los mensajes de error nunca incluyen
 * el token, que viaja en la URL.
 */

import type { Notifier, NotifyResult } from "../ports";

/** Tope de espera por envío: un Telegram colgado no debe trabar la corrida entera. */
const TIMEOUT_MS = 10_000;

type TelegramEnv = Record<string, string | undefined>;

export function createTelegramNotifier(
  env: TelegramEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Notifier {
  return {
    async send(message: string): Promise<NotifyResult> {
      const token = env.TELEGRAM_BOT_TOKEN?.trim();
      const chatId = env.TELEGRAM_CHAT_ID?.trim();
      if (!token || !chatId) {
        return { status: "skipped", reason: "Telegram no está configurado (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)" };
      }

      try {
        const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: message }),
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) {
          return { status: "failed", error: `Telegram respondió HTTP ${response.status}` };
        }
        return { status: "sent" };
      } catch (error) {
        // El mensaje de un error de red puede incluir la URL (con el token): no se propaga.
        return {
          status: "failed",
          error: `No se pudo contactar a Telegram (${error instanceof Error ? error.name : "error"})`,
        };
      }
    },
  };
}
