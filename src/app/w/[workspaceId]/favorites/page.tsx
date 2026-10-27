import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { uuidSchema } from "@/features/auth/validation";
import { pageSummarySchema } from "@/features/pages/model/validation";
import { PageList } from "@/features/pages/page-list";
import { getTranslations } from "@/lib/i18n/server";
import { createClient, currentUser } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("navigation.favorites") };
}
export default async function FavoritesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ afterId?: string }>;
}) {
  const t = await getTranslations();

  const user = await currentUser();
  if (!user) redirect("/login");
  const { workspaceId } = await params;
  const after = (await searchParams).afterId;
  const client = await createClient();
  let query = client
    .from("page_favorites")
    .select("page_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .order("page_id")
    .limit(51);
  if (after && uuidSchema.safeParse(after).success) query = query.gt("page_id", after);
  const { data: favorites, error } = await query;
  if (error) throw new Error(t("pages.favoritesFailed"));
  const ids = favorites.slice(0, 50).map((favorite) => favorite.page_id);
  const pages = ids.length
    ? await client.from("pages").select("id,title,icon,position,revision").in("id", ids).order("id")
    : { data: [], error: null };
  if (pages.error) throw new Error(t("pages.favoritePagesFailed"));
  return (
    <>
      <div className="document-heading">
        <h1>{t("navigation.favorites")}</h1>
        <p>{t("pages.favoritesDescription")}</p>
      </div>
      <PageList
        pages={z
          .array(pageSummarySchema)
          .parse((pages.data ?? []).map((page) => ({ ...page, parent_id: null })))}
        workspaceId={workspaceId}
        canReorder={false}
      />
      {favorites.length > 50 && (
        <Link className="pagination-link" href={`?afterId=${ids.at(-1)}`}>
          {t("pages.nextFavorites")}
        </Link>
      )}
    </>
  );
}
