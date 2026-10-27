import { notFound } from "next/navigation";
import { z } from "zod";
import { publicationToken, publicPageSchema } from "@/features/sharing/model";
import { PublicPageDocument } from "@/features/sharing/public-page";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Página compartilhada · Bloco",
  robots: { index: false, follow: false, nocache: true },
};
export default async function PublishedPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ after?: string }>;
}) {
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
        <h1>Esta publicação excede o tamanho disponível.</h1>
        <p>
          O conteúdo foi preservado. Peça ao proprietário para dividir a página publicada em páginas menores.
        </p>
      </main>
    );
  if (result.error || !result.data) notFound();
  const parsed = publicPageSchema.safeParse(result.data);
  if (!parsed.success)
    return (
      <main className="public-page">
        <h1>Publicação temporariamente indisponível.</h1>
        <p>Tente atualizar esta página em instantes.</p>
      </main>
    );
  return <PublicPageDocument data={parsed.data} token={token.data} />;
}
