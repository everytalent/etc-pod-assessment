export default function EditLoading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="h-7 w-40 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-9 w-72 animate-pulse rounded bg-muted" />
      <div className="mt-8 h-72 w-full animate-pulse rounded-2xl bg-muted" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 w-full animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    </main>
  );
}
