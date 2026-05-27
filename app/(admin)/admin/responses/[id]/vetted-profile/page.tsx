/**
 * /admin/responses/[id]/vetted-profile
 *
 * Drill-in for the synthesised Vetted Talent Profile. Per-spec cards,
 * override workflows with required reasoning, mindset chips,
 * qualified scopes, reservation flags.
 */

import { notFound } from "next/navigation";

import { VettedProfilePanel } from "@/components/admin/VettedProfilePanel";
import { requireEditorApi } from "@/lib/auth/admin";
import { getProfileBundleByResponse } from "@/lib/engines/assessment/profile/repository";

export const dynamic = "force-dynamic";

export default async function VettedProfilePage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const auth = await requireEditorApi();
  if (!auth.user) return null;

  const bundle = await getProfileBundleByResponse(id);
  if (!bundle) notFound();

  return <VettedProfilePanel initial={bundle} responseId={id} />;
}
