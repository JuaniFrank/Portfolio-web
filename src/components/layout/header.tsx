"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PortfolioSwitcher } from "@/components/layout/portfolio-switcher";
import { CurrencySwitcher } from "@/components/layout/currency-switcher";

export function Header() {
  const { data } = useSession();

  return (
    <header className="flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/40 px-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="text-sm font-semibold text-zinc-100">
          Portafolio
        </Link>
        <PortfolioSwitcher />
      </div>
      <div className="flex items-center gap-3">
        <CurrencySwitcher />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <span className="max-w-[160px] truncate text-left text-xs">
                {data?.user?.name ?? data?.user?.email ?? "Usuario"}
              </span>
              <ChevronDown className="h-4 w-4 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{data?.user?.name ?? "Cuenta"}</p>
                <p className="text-xs leading-none text-zinc-400">{data?.user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void signOut({ callbackUrl: "/" });
              }}
            >
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
