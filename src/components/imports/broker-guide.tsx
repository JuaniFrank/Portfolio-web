"use client";

import { useState } from "react";
import {
  ChevronDown,
  HelpCircle,
  AlertTriangle,
  CheckCircle2,
  Maximize2,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BrokerImportCode } from "@/lib/importers/types";
import { cn } from "@/lib/utils";

type BrokerGuideProps = {
  brokerCode: BrokerImportCode;
};

type StepGuide = {
  step: number;
  title: string;
  description: string;
  tip?: string;
  imageSrc: string;
  imageAlt: string;
  badge?: string;
};

const BALANZ_STEPS: StepGuide[] = [
  {
    step: 1,
    title: "Ir a Actividad",
    description: "Iniciá sesión en Balanz web y navegá en el menú lateral izquierdo a \"Actividad\".",
    tip: "Es el ícono con forma de comprobante/hoja en la barra lateral principal.",
    imageSrc: "/guides/balanz/step1.webp",
    imageAlt: "Menú lateral de Balanz con la sección Actividad resaltada",
  },
  {
    step: 2,
    title: "Filtrar",
    description: "Ir a la pestaña \"Movimientos\" y filtrar por el período que deseás importar.",
    tip: "Balanz suele mostrar por defecto los últimos 3 meses. Ampliá el selector de \"Periodo\" si querés traer un rango mayor o histórico.",
    imageSrc: "/guides/balanz/step2.webp",
    imageAlt: "Pestaña Movimientos y filtros de fecha en Balanz",
  },
  {
    step: 3,
    title: "Descargar Excel",
    description: "Hacé clic en el ícono de \"Descargar\" arriba a la derecha de la tabla. No confundir con el de Reportes.",
    badge: "Ojo: usar Descargar, no Reportes",
    tip: "El botón violeta \"Reportes\" descarga un resumen en PDF. El botón correcto es el que tiene la flechita hacia abajo sobre la grilla (\"Descargar\"), que genera el archivo .xlsx.",
    imageSrc: "/guides/balanz/step3.webp",
    imageAlt: "Botón Descargar de la tabla en Balanz vs botón violeta Reportes",
  },
];

export function BrokerGuide({ brokerCode }: BrokerGuideProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [zoomedImage, setZoomedImage] = useState<StepGuide | null>(null);

  if (brokerCode !== "BALANZ") {
    return null;
  }

  return (
    <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 transition-all shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-zinc-200 hover:text-zinc-50"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-500/10 text-teal-400 ring-1 ring-teal-500/20">
            <HelpCircle className="h-4 w-4" />
          </span>
          <span className="font-semibold text-zinc-100">
            ¿Cómo descargar el archivo de movimientos en Balanz?
          </span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">
            {isOpen ? "Ocultar guía" : "Ver pasos con capturas"}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-zinc-400 transition-transform duration-200",
              isOpen && "rotate-180 text-teal-400"
            )}
          />
        </div>
      </button>

      {isOpen && (
        <div className="mt-5 space-y-4 border-t border-zinc-800/80 pt-5">
          {/* Filas apiladas ocupando el 100% del ancho */}
          <div className="space-y-4">
            {BALANZ_STEPS.map((item) => (
              <div
                key={item.step}
                className="group relative w-full overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-5 transition-all hover:border-zinc-700/90 hover:bg-zinc-900/60 shadow-sm"
              >
                <div className="grid gap-5 md:grid-cols-12 md:items-center">
                  {/* Columna de Texto explicativo (5 columnas) */}
                  <div className="space-y-2.5 md:col-span-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-500/20 text-xs font-bold text-teal-400 ring-1 ring-teal-500/30">
                        {item.step}
                      </span>
                      <h4 className="text-sm font-semibold text-zinc-100">{item.title}</h4>

                      {item.badge && (
                        <Badge
                          variant="secondary"
                          className="bg-amber-500/10 text-amber-300 border-amber-500/30 text-[10px] px-2 py-0.5"
                        >
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          {item.badge}
                        </Badge>
                      )}
                    </div>

                    <p className="text-xs leading-relaxed text-zinc-200">
                      {item.description}
                    </p>

                    {item.tip && (
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px] leading-relaxed text-zinc-400">
                        <span className="font-medium text-zinc-300">Detalle: </span>
                        {item.tip}
                      </div>
                    )}
                  </div>

                  {/* Columna de Imagen grande y nítida (7 columnas) */}
                  <div className="md:col-span-7">
                    <button
                      type="button"
                      onClick={() => setZoomedImage(item)}
                      className="group/img relative block w-full overflow-hidden rounded-lg border border-zinc-800/90 bg-zinc-950 p-2 text-center transition-all hover:border-teal-500/50 hover:shadow-md"
                    >
                      <div className="relative flex min-h-[140px] max-h-[220px] w-full items-center justify-center overflow-hidden rounded bg-zinc-950/80">
                        <img
                          src={item.imageSrc}
                          alt={item.imageAlt}
                          className="max-h-[200px] w-auto max-w-full rounded object-contain transition-transform duration-200 group-hover/img:scale-[1.02]"
                          loading="lazy"
                        />
                      </div>

                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/40 opacity-0 backdrop-blur-[1px] transition-opacity group-hover/img:opacity-100">
                        <span className="flex items-center gap-1.5 rounded-full bg-zinc-900/90 px-3 py-1.5 text-xs font-medium text-zinc-200 border border-zinc-700 shadow-xl">
                          <Maximize2 className="h-3.5 w-3.5 text-teal-400" />
                          Click para ampliar
                        </span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-teal-900/30 bg-teal-950/20 p-3.5 text-xs text-teal-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-400" />
            <span>
              Subí el archivo <strong>.xlsx</strong> original directamente como lo descarga Balanz, sin editarle los nombres de columnas para que el analizador automático lo procese sin errores.
            </span>
          </div>
        </div>
      )}

      {/* Lightbox / Modal para ampliar imagen en tamaño completo */}
      <Dialog open={zoomedImage !== null} onOpenChange={(o) => !o && setZoomedImage(null)}>
        <DialogContent className="max-w-4xl overflow-hidden p-0 bg-zinc-950 border-zinc-800">
          <DialogHeader className="p-4 pb-2 border-b border-zinc-800/80">
            <DialogTitle className="flex items-center gap-2.5 text-sm text-zinc-100">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-500 text-zinc-950 text-xs font-bold">
                {zoomedImage?.step}
              </span>
              <span>Paso {zoomedImage?.step}: {zoomedImage?.title}</span>
            </DialogTitle>
          </DialogHeader>

          {zoomedImage && (
            <div className="space-y-3 p-5">
              <div className="flex items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                <img
                  src={zoomedImage.imageSrc}
                  alt={zoomedImage.imageAlt}
                  className="max-h-[75vh] w-auto max-w-full rounded object-contain"
                />
              </div>
              <p className="text-xs text-zinc-300 text-center">
                {zoomedImage.description} {zoomedImage.tip}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
