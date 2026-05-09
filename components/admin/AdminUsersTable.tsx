"use client";

/**
 * Admin allowlist UI — table of admin_users with an inline invite form.
 *
 * Posts to /api/admin/admin-users (POST = invite, DELETE per id = remove).
 * Role badge differentiates superadmin from admin.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type { AdminUser } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(255),
  role: z.enum(["superadmin", "admin", "editor", "assessor"]),
});
type InviteValues = z.infer<typeof inviteSchema>;

const ROLE_STYLE: Record<AdminUser["role"], string> = {
  superadmin: "border-etc-marigold bg-etc-marigold/15 text-etc-black",
  admin: "border-etc-marigold/60 bg-etc-marigold/5 text-foreground",
  editor: "border-border bg-card text-foreground",
  assessor: "border-border bg-muted text-muted-foreground",
};

/** Roles the inviter is allowed to grant. Mirrors lib/auth/admin.rolesGrantableBy. */
function grantableRoles(role: AdminUser["role"]): AdminUser["role"][] {
  if (role === "superadmin") return ["superadmin", "admin", "editor", "assessor"];
  if (role === "admin") return ["editor", "assessor"];
  return [];
}

/** Roles the current admin can remove from the allowlist. */
function canRemoveRole(
  currentRole: AdminUser["role"],
  targetRole: AdminUser["role"],
): boolean {
  if (currentRole === "superadmin") return true;
  if (currentRole === "admin") {
    return targetRole === "editor" || targetRole === "assessor";
  }
  return false;
}

export function AdminUsersTable({
  rows: initialRows,
  currentAdminId,
  currentAdminRole,
}: {
  rows: AdminUser[];
  currentAdminId: string;
  currentAdminRole: AdminUser["role"];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<AdminUser[]>(initialRows);
  const [serverError, setServerError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const grantable = grantableRoles(currentAdminRole);
  const canInvite = grantable.length > 0;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: grantable[0] ?? "assessor" },
  });

  const onInvite = async (values: InviteValues) => {
    setServerError(null);
    setInviteNotice(null);
    try {
      const res = await fetch("/api/admin/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (res.status === 409) {
        setServerError("That email is already on the allowlist.");
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed (${res.status})`);
      }
      const data = (await res.json()) as {
        admin: AdminUser;
        invite_email_sent: boolean;
        invite_email_error: string | null;
      };
      setRows((prev) => [data.admin, ...prev]);
      reset({ email: "", role: grantable[0] ?? "assessor" });
      if (data.invite_email_sent) {
        setInviteNotice(
          `Invitation email sent to ${data.admin.email}. They can also sign in directly via /admin/login.`,
        );
      } else {
        setInviteNotice(
          `Added ${data.admin.email} to the allowlist. (Invite email not delivered: ${data.invite_email_error ?? "unknown"}.) They can still sign in via /admin/login.`,
        );
      }
      router.refresh();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Invite failed");
    }
  };

  const onDelete = async (id: string, email: string) => {
    if (!confirm(`Remove ${email} from the admin allowlist?`)) return;
    setBusyId(id);
    setServerError(null);
    try {
      const res = await fetch(`/api/admin/admin-users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(data.message ?? data.error ?? `Failed (${res.status})`);
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
      router.refresh();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {canInvite ? (
        <form
          onSubmit={handleSubmit(onInvite)}
          noValidate
          className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-[1fr_160px_120px] sm:items-end"
        >
          <label className="flex flex-col gap-1.5 sm:col-span-1">
            <span className="text-xs font-medium text-foreground">Email</span>
            <input
              type="email"
              autoComplete="email"
              placeholder="new.user@example.com"
              {...register("email")}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold"
            />
            {errors.email && (
              <span className="text-[0.7rem] text-destructive">
                {errors.email.message}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Role</span>
            <select
              {...register("role")}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:border-etc-marigold"
            >
              {grantable.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {isSubmitting ? "Adding…" : "Invite"}
          </button>
        </form>
      ) : (
        <p className="rounded-xl border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">
          You don&rsquo;t have permission to invite users.
        </p>
      )}

      {serverError && (
        <p className="rounded-xl border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {serverError}
        </p>
      )}

      {inviteNotice && (
        <p className="rounded-xl border border-etc-marigold bg-etc-marigold/10 p-3 text-xs text-etc-black">
          {inviteNotice}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No admin users.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-3 pl-5 font-medium">Email</th>
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Added</th>
                <th className="px-3 py-3 pr-5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-3 pl-5 align-middle">
                    {r.email}
                    {r.id === currentAdminId && (
                      <span className="ml-2 text-[0.7rem] text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider",
                        ROLE_STYLE[r.role],
                      )}
                    >
                      {r.role}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-middle text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-3 py-3 pr-5 text-right align-middle">
                    {r.id === currentAdminId ? (
                      <span className="text-[0.7rem] text-muted-foreground">—</span>
                    ) : !canRemoveRole(currentAdminRole, r.role) ? (
                      <span
                        className="text-[0.7rem] text-muted-foreground"
                        title="You don't have permission to remove this role."
                      >
                        —
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void onDelete(r.id, r.email)}
                        disabled={busyId === r.id}
                        className="rounded-lg border border-border bg-background px-2.5 py-1 text-[0.7rem] text-destructive hover:border-destructive disabled:opacity-50"
                      >
                        {busyId === r.id ? "…" : "Remove"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
