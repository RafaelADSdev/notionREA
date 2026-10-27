import { TrashList } from "@/features/pages/trash-list";
import { getTranslations } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("navigation.trash") };
}
export default async function TrashPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const t = await getTranslations();

  const { workspaceId } = await params;
  const client = await createClient();
  const { data, error } = await client.rpc("list_trash", {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(t("pages.trashLoadFailed"));
  const items = data.slice(0, 50);
  return (
    <>
      <div className="document-heading">
        <h1>{t("navigation.trash")}</h1>
        <p>{t("pages.trashDescription")}</p>
      </div>
      <TrashList workspaceId={workspaceId} initialItems={items} initialMore={data.length > 50} />
    </>
  );
}
