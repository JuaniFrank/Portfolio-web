import { formatMoney, type ViewCurrency } from "../format";

/** Importe con signo explícito: en un resultado el signo es la información principal. */
export function formatSignedMoney(
  value: number,
  currency: ViewCurrency,
  { compact = false }: { compact?: boolean } = {}
): string {
  // Compacto = pesos sin centavos: en las columnas de movers los centavos no aportan y
  // son justo lo que hace que la fila no entre.
  const formatted =
    compact && currency === "ARS"
      ? value.toLocaleString("es-AR", { style: "currency", currency, maximumFractionDigits: 0 })
      : formatMoney(value, currency);
  return `${value > 0 ? "+" : ""}${formatted}`;
}
