import { notFound } from "next/navigation";
import { LandingEditor } from "@/components/LandingEditor";
import { Empty } from "@/components/ui";
import { can, isServing } from "@/lib/accounts";
import { contentOf, getLanding, listVersions } from "@/lib/landings";
import { requireCtx } from "@/lib/session";

export default async function EditorPage({ params }: PageProps<"/app/landings/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx();
  if (!can(ctx, "landing.edit")) return <Empty title="접근 권한이 없습니다" />;
  const l = await getLanding(ctx, id);
  if (!l || l.status === "archived") notFound();
  return (
    <LandingEditor
      landing={{ id: l.id, slug: l.slug, status: l.status, mode: l.mode, campaignTitle: `${l.client_name} · ${l.campaign_title}`, hasPublished: !!l.published_version_id }}
      initial={contentOf(l)}
      versions={(await listVersions(ctx, id)).map(({ id, note, author_name, published_at }) => ({ id, note, author_name, published_at }))}
      serving={await isServing(ctx.workspaceId)}
    />
  );
}
