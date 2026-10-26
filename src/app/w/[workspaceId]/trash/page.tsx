import { createClient } from "@/lib/supabase/server";
import { TrashList } from "@/features/pages/trash-list";

export const metadata = { title: "Lixeira" };
export default async function TrashPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const client = await createClient();
  const { data, error } = await client.rpc("list_trash", {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error("Não foi possível carregar a lixeira.");
  const items = data.slice(0, 50);
  return (
    <>
      <div className="document-heading">
        <h1>Lixeira</h1>
        <p>Restaure suas páginas e suas filhas. Exclusões anteriores independentes são preservadas.</p>
      </div>
      <TrashList workspaceId={workspaceId} initialItems={items} initialMore={data.length > 50} />
    </>
  );
}
