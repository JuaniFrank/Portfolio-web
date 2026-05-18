import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center gap-10 px-6 py-16">
      <div className="space-y-4">
        <p className="text-sm text-zinc-400">Portfolio manager (Argentina)</p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
          Portafolio
        </h1>
        <p className="max-w-2xl text-pretty text-base leading-relaxed text-zinc-400">
          Esqueleto técnico listo para agregar features de dominio: posiciones, performance, imports y
          market data.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/login">Ingresar</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/register">Crear cuenta</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/dashboard">Ir al dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
