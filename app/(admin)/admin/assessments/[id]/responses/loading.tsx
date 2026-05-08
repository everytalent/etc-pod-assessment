export default function ResponsesLoading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="h-7 w-40 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-9 w-72 animate-pulse rounded bg-muted" />
      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border px-5 py-4 last:border-b-0"
          >
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-4 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </main>
  );
}
