"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CalendarSync,
  Coins,
  Download,
  LayoutDashboard,
  LineChart,
  Settings,
  Shapes,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portfolios", label: "Portfolios", icon: Wallet },
  { href: "/transactions", label: "Transacciones", icon: LineChart },
  { href: "/dividends", label: "Dividendos", icon: Coins },
  { href: "/events", label: "Eventos", icon: CalendarSync },
  { href: "/imports", label: "Imports", icon: Download },
  { href: "/brokers", label: "Brokers", icon: Building2 },
  { href: "/instruments", label: "Instrumentos", icon: Shapes },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 flex-col border-r border-zinc-800 bg-zinc-950/60">
      <div className="px-4 py-5">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight text-zinc-100">
          Portafolio
        </Link>
        <p className="mt-1 text-xs text-zinc-500">Portfolio manager (AR)</p>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2 pb-6">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-zinc-900 text-zinc-50 ring-1 ring-zinc-800"
                  : "text-zinc-300 hover:bg-zinc-900/70 hover:text-zinc-50"
              )}
            >
              <Icon className="h-4 w-4 text-zinc-400" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
