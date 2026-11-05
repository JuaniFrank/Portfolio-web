"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CalendarSync,
  CandlestickChart,
  Coins,
  Download,
  LayoutDashboard,
  LineChart,
  Landmark,
  PanelLeftClose,
  PanelLeftOpen,
  TrendingUp,
} from "lucide-react";
import { PaletteToggle } from "@/components/layout/palette-toggle";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useStoredBoolean } from "@/lib/ui/use-stored-boolean";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/rendimientos", label: "Rendimientos", icon: TrendingUp },
  { href: "/dividends", label: "Dividendos", icon: Coins },
  { href: "/bonds", label: "Bonos (ONs)", icon: Landmark },
  { href: "/activos", label: "Activos", icon: CandlestickChart },
  { href: "/alertas", label: "Alertas", icon: Bell },
  { href: "/events", label: "Eventos", icon: CalendarSync },
  { href: "/transactions", label: "Transacciones", icon: LineChart },
  { href: "/imports", label: "Imports", icon: Download },
  // { href: "/portfolios", label: "Portfolios", icon: Wallet },
  // { href: "/brokers", label: "Brokers", icon: Building2 },
  // { href: "/instruments", label: "Instrumentos", icon: Shapes },
  // { href: "/settings", label: "Settings", icon: Settings },
] as const;

/** Marca, navegación y toggles. Compartido por la barra fija (desktop) y el drawer (mobile). */
export function SidebarContent({
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
}: {
  onNavigate?: () => void;
  /** Icon-only rail (desktop only; the mobile drawer is never collapsed) */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={100}>
      <div
        className={cn(
          "flex items-center py-5",
          collapsed ? "justify-center px-2" : "justify-between px-4"
        )}
      >
        {collapsed ? (
          <Link
            href="/dashboard"
            onClick={onNavigate}
            aria-label="Portafolio"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-200 text-sm font-bold text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
          >
            P
          </Link>
        ) : (
          <div className="min-w-0 whitespace-nowrap">
            <Link
              href="/dashboard"
              onClick={onNavigate}
              className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
            >
              Portafolio
            </Link>
            <p className="mt-1 text-xs text-zinc-500">Portfolio manager (AR)</p>
          </div>
        )}
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-4">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const link = (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-label={collapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-zinc-200 text-zinc-900 ring-1 ring-zinc-300 dark:bg-zinc-900 dark:text-zinc-50 dark:ring-zinc-800"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900/70 dark:hover:text-zinc-50"
              )}
            >
              <Icon className="h-5 w-5 shrink-0 text-zinc-500 dark:text-zinc-400" />
              {!collapsed && <span className="truncate whitespace-nowrap">{item.label}</span>}
            </Link>
          );
          if (!collapsed) return link;
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
      <div className="space-y-1 border-t border-zinc-200 px-2 py-3 dark:border-zinc-800">
        <PaletteToggle collapsed={collapsed} />
        <ThemeToggle collapsed={collapsed} />
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
            title={collapsed ? "Expandir menú" : "Contraer menú"}
            className={cn(
              "flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900/70 dark:hover:text-zinc-50",
              collapsed && "justify-center px-0"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
            ) : (
              <>
                <PanelLeftClose className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
                <span className="whitespace-nowrap">Contraer menú</span>
              </>
            )}
          </button>
        )}
      </div>
    </TooltipProvider>
  );
}

/** Barra lateral fija (colapsable a rail de íconos); por debajo de `md` la reemplaza el drawer de `MobileNav`. */
export function Sidebar() {
  const [collapsed, setCollapsed] = useStoredBoolean("nav:collapsed", false);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col self-start overflow-hidden border-r border-zinc-200 bg-zinc-50/80 transition-[width] duration-200 ease-out md:flex dark:border-zinc-800 dark:bg-zinc-950/60",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <SidebarContent collapsed={collapsed} onToggleCollapsed={() => setCollapsed(!collapsed)} />
    </aside>
  );
}
