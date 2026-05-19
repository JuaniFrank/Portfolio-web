"use client";

import { useCallback, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";

type FileDropzoneProps = {
  accept: string;
  disabled?: boolean;
  onFile: (file: File) => void;
};

export function FileDropzone({ accept, disabled, onFile }: FileDropzoneProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      onFile(file);
    },
    [onFile]
  );

  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 transition-colors",
        dragOver ? "border-blue-500 bg-blue-500/5" : "border-zinc-700 bg-zinc-900/50",
        disabled && "pointer-events-none opacity-50"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        type="file"
        className="sr-only"
        accept={accept}
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
        <FileSpreadsheet className="h-6 w-6 text-zinc-300" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-zinc-200">
          Arrastrá tu archivo o <span className="text-blue-400">elegí uno</span>
        </p>
        <p className="mt-1 text-xs text-zinc-500">Solo archivos .xlsx</p>
      </div>
    </label>
  );
}
