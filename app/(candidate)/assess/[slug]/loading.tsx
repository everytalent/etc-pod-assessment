export default function AssessLoading() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6 py-10">
      <div className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-7 w-3/4 animate-pulse rounded bg-muted" />
        <div className="mt-5 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-10 w-full animate-pulse rounded-xl bg-muted"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
