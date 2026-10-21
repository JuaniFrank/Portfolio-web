import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-zinc-500">Error 404</p>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        No encontramos esta página
      </h1>
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        La dirección no existe o el recurso ya no está disponible.
      </p>
      <Button asChild>
        <Link href="/dashboard">Ir al dashboard</Link>
      </Button>
    </main>
  );
}
