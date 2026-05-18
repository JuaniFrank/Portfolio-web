"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PortfolioSwitcher() {
  return (
    <div className="w-[220px]">
      <Select disabled>
        <SelectTrigger aria-label="Portfolio">
          <SelectValue placeholder="Portfolio (próximamente)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="stub">stub</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
