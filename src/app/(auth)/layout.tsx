export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-zinc-950 p-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
