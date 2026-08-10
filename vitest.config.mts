import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Los tests cubren los módulos puros del motor de rendimientos (`returns`, `months`,
 * `price-series`, `cashflows`, `benchmarks`): matemática y lookup, sin DB ni red.
 *
 * `series.ts` queda afuera a propósito: es el orquestador que habla con Prisma, y
 * testearlo pide fixtures de base de datos. Está diseñado para que toda la lógica
 * riesgosa viva en los módulos puros y él solo cablee.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
