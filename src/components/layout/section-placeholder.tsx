export function SectionPlaceholder({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">{title}</h1>
      {subtitle ? <p className="text-sm text-zinc-500">{subtitle}</p> : null}
      <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
        Esta sección será implementada en la siguiente fase.
      </p>
    </div>
  );
}
