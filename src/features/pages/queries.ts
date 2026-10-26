import "server-only";
import { createClient } from "@/lib/supabase/server";
import { pageSummarySchema } from "./model/validation";
import { z } from "zod";

export async function childrenOf(
  workspaceId: string,
  parentId: string | null,
  afterPosition?: string,
  afterId?: string,
) {
  const client = await createClient();
  const { data, error } = await client.rpc("list_page_children", {
    p_workspace_id: workspaceId,
    ...(parentId ? { p_parent_id: parentId } : {}),
    ...(afterPosition && afterId ? { p_after_position: afterPosition, p_after_id: afterId } : {}),
  });
  if (error) throw new Error("Não foi possível carregar as páginas.");
  const items = z.array(pageSummarySchema).parse(data);
  return { items: items.slice(0, 50), more: items.length > 50 };
}

export async function searchPages(
  workspaceId: string,
  query: string,
  cursor?: { rank?: number | undefined; id?: string | undefined; updatedAt?: string | undefined },
) {
  const client = await createClient();
  const { data, error } = await client.rpc("search_pages", {
    p_workspace_id: workspaceId,
    p_query: query,
    ...(cursor?.id ? { p_after_id: cursor.id } : {}),
    ...(cursor?.rank !== undefined ? { p_after_rank: cursor.rank } : {}),
    ...(cursor?.updatedAt ? { p_after_updated_at: cursor.updatedAt } : {}),
  });
  if (error) throw new Error("Não foi possível buscar as páginas.");
  return { items: data.slice(0, 50), more: data.length > 50 };
}
