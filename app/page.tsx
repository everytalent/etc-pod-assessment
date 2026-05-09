import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        Energy Talent Co · POD OS
      </p>
      <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
        Solar Talent Assessment
      </h1>
      <p className="mt-6 max-w-md text-base text-muted-foreground">
        Conversational vetting for Solar Tech and Business Development
        candidates joining the ETC POD network.
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/assess/demo"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Try a demo assessment
        </Link>
      </div>
    </main>
  );
}
