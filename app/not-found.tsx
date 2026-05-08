import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6 py-10">
      <div className="w-full rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          404
        </p>
        <h1 className="mt-2 text-2xl font-bold">Not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The page you&rsquo;re looking for doesn&rsquo;t exist.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm hover:border-etc-marigold"
        >
          Back home
        </Link>
      </div>
    </main>
  );
}
