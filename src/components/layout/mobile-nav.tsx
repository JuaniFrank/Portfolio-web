"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarContent } from "@/components/layout/sidebar";

/**
 * Navegación para pantallas por debajo de `md`: la barra lateral fija se oculta y este
 * botón abre la misma navegación en un drawer. Usa el Dialog de radix (focus trap, Esc y
 * click afuera para cerrar). Se cierra al navegar vía `onNavigate` en cada link.
 */
export function MobileNav() {
  const [open, setOpen] = React.useState(false);

  // Widening past `md` hides the drawer via CSS but would leave the Dialog open, keeping
  // the scroll lock and focus trap; close it when the desktop sidebar takes over.
  React.useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Abrir menú de navegación"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col border-r border-zinc-200 bg-zinc-50 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left md:hidden dark:border-zinc-800 dark:bg-zinc-950"
        >
          <DialogPrimitive.Title className="sr-only">Menú de navegación</DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="absolute right-3 top-4 rounded-sm text-zinc-500 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
            aria-label="Cerrar menú de navegación"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
