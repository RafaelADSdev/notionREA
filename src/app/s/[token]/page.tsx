import { notFound } from "next/navigation";
import { z } from "zod";
import { publicationToken, publicPageSchema } from "@/features/sharing/model";
import { PublishedDocument } from "@/features/sharing/public-content-client";
import { getTranslations } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations();
  return {
    title: t("sharing.pageTitle"),
    robots: { index: false, follow: false, nocache: true },
  };
}
export default async function PublishedPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ after?: string }>;
}) {
  const t = await getTranslations();

  const token = publicationToken.safeParse((await params).token);
  if (!token.success) notFound();
  const query = await searchParams,
    after = z.uuid().optional().safeParse(query.after);
  if (!after.success) notFound();
  const client = await createClient();
  const result = await client.rpc("read_page_publication", {
    p_token: token.data,
    ...(after.data ? { p_after_id: after.data } : {}),
  });
  if (result.error?.code === "54000")
    return (
      <main className="public-page">
        <h1>{t("sharing.tooLarge")}</h1>
        <p>{t("sharing.preservedLarge")}</p>
      </main>
    );
  if (result.error || !result.data) notFound();
  const parsed = publicPageSchema.safeParse(result.data);
  if (!parsed.success)
    return (
      <main className="public-page">
        <h1>{t("sharing.temporary")}</h1>
        <p>{t("sharing.refreshSoon")}</p>
      </main>
    );
  return <PublishedDocument data={parsed.data} token={token.data} />;
}
