import type { BalanzRawRow } from "../types";
import fixtureJson from "./balanz-movimientos.json";

/** 87 filas del export real Balanz (`movimientos (1).xlsx`). */
export const balanzMovimientosFixture = fixtureJson as BalanzRawRow[];
