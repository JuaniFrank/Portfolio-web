"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Consequences of the deletion; rendered under the "can't be undone" line. */
  children: ReactNode;
  confirmLabel: string;
  /** Resolves `{ ok: false }` to keep the dialog open and toast the error. */
  onConfirm: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Called after a successful deletion, before the dialog closes. */
  onDeleted: () => void;
};

/** Generic destructive confirmation for the transactions screen. */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  onConfirm,
  onDeleted,
}: ConfirmDeleteDialogProps) {
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      const result = await onConfirm();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onDeleted();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={pending ? () => {} : onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            {title}
          </DialogTitle>
          <DialogDescription>Esta acción no se puede deshacer.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-zinc-400">{children}</div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={pending}
          >
            {pending ? "Borrando…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
