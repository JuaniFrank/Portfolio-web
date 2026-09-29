"use client";

import { AlertTriangle, Info } from "lucide-react";
import type { DashboardNotice } from "@/lib/dashboard/dashboard-notices";
import { cn } from "@/lib/utils";

type Props = {
  notices: DashboardNotice[];
};

/** Oculto cuando no hay nada que reportar: no hace falta un "todo bien" explícito. */
export function NoticesPanel({ notices }: Props) {
  if (notices.length === 0) return null;

  return (
    <div className="space-y-2">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={cn(
            "flex items-start gap-3 rounded-md border p-3 text-xs",
            notice.severity === "warning"
              ? "border-amber-900/50 bg-amber-950/20 text-amber-200"
              : "border-zinc-800 bg-zinc-900/40 text-zinc-300"
          )}
        >
          {notice.severity === "warning" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-400" />
          )}
          <div className="min-w-0">
            <p className="font-medium">{notice.title}</p>
            <p className="mt-0.5 leading-relaxed opacity-90">{notice.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
