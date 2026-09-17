"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrency } from "@/components/providers/currency-provider";
import type { ViewCurrency } from "@/lib/rendimientos/types";

export function CurrencySwitcher() {
  const { currency, setCurrency } = useCurrency();

  return (
    <div className="w-[120px]">
      <Select value={currency} onValueChange={(value) => setCurrency(value as ViewCurrency)}>
        <SelectTrigger aria-label="Moneda de visualización">
          <SelectValue placeholder="Moneda" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ARS">ARS</SelectItem>
          <SelectItem value="USD">USD</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
