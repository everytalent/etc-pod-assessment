/**
 * /admin/skillboards/[id] — detail page.
 *
 * Server-renders the initial board state, hands off to a client
 * component that owns the polling loop, cell-grid interactions, and
 * the activation banner.
 */

import { notFound } from "next/navigation";

import { SkillboardDetailView } from "@/components/admin/SkillboardDetailView";
import { requireAdminApi } from "@/lib/auth/admin";
import { getSkillboardDetail } from "@/lib/engines/assessment/skillboards/repository";

export const dynamic = "force-dynamic";

export default async function SkillboardDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const auth = await requireAdminApi();
  if (!auth.user) return null;

  const detail = await getSkillboardDetail(id);
  if (!detail) {
    notFound();
  }

  return (
    <SkillboardDetailView
      initial={detail}
      canApprove={auth.session.admin.canApproveSkillboards}
    />
  );
}
