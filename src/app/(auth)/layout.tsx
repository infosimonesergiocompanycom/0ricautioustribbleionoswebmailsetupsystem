export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="mb-12 text-center text-sm tracking-[0.2em] text-muted-foreground uppercase">Segretario</p>
        {children}
      </div>
    </main>
  );
}
