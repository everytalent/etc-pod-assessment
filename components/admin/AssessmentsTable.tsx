/**
 * Dashboard table — rendered as a Server Component (no interactivity beyond
 * links). Status badges use ETC tokens; numbers are formatted plainly.
 */

import Link from "next/link";

import { cn } from "@/lib/utils";

type Row = {
  id: string;
  title: string;
  slug: string;
  roleType: "tech" | "bd";
  status: "draft" | "published" | "archived";
  passThreshold: number;
  updatedAt: Date;
  responseCount: number;
  submittedCount: number;
  avgScore: number | null;
};

const STATUS_STYLES: Record<Row["status"], string> = {
  draft: "border-border bg-muted text-muted-foreground",
  published: "border-etc-marigold bg-etc-marigold/15 text-etc-black",
  archived: "border-border bg-secondary text-muted-foreground line-through",
};

const ROLE_LABEL: Record<Row["roleType"], string> = {
  tech: "Tech",
  bd: "BD",
};

export function AssessmentsTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
        <h2 className="text-lg font-semibold">No assessments yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Click <span className="font-medium">New assessment</span> to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <Th className="pl-5">Title</Th>
            <Th>Status</Th>
            <Th>Track</Th>
            <Th className="text-right">Responses</Th>
            <Th className="text-right">Avg score</Th>
            <Th className="pr-5 text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-b-0">
              <Td className="pl-5">
                <div className="font-semibold text-foreground">{r.title}</div>
                <div className="mt-0.5 font-mono text-[0.7rem] text-muted-foreground">
                  /{r.slug}
                </div>
              </Td>
              <Td>
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2 py-0.5 text-[0.68rem] font-medium uppercase tracking-wider",
                    STATUS_STYLES[r.status],
                  )}
                >
                  {r.status}
                </span>
              </Td>
              <Td>{ROLE_LABEL[r.roleType]}</Td>
              <Td className="text-right tabular-nums">
                {r.submittedCount}
                <span className="text-xs text-muted-foreground"> / {r.responseCount}</span>
              </Td>
              <Td className="text-right tabular-nums">
                {r.avgScore !== null ? r.avgScore.toFixed(1) : "—"}
              </Td>
              <Td className="pr-5 text-right">
                <div className="flex justify-end gap-2 text-xs">
                  <Link
                    href={`/admin/assessments/${r.id}/edit`}
                    className="rounded-lg border border-border bg-background px-2.5 py-1 hover:border-etc-marigold"
                  >
                    Edit
                  </Link>
                  <Link
                    href={`/admin/assessments/${r.id}/responses`}
                    className="rounded-lg border border-border bg-background px-2.5 py-1 hover:border-etc-marigold"
                  >
                    Responses
                  </Link>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={cn("px-3 py-3 font-medium", className)}>{children}</th>;
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-3 py-3 align-middle", className)}>{children}</td>;
}
