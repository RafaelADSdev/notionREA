import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { uuidSchema } from "@/features/auth/validation";
import { CreateDatabaseControl } from "@/features/databases/create-control";
import { DatabaseClient } from "@/features/databases/database-client";
import { RecordProperties } from "@/features/databases/record-properties";
import { PageEditor } from "@/features/editor/ui/page-editor";
import { BreadcrumbTrail } from "@/features/pages/breadcrumbs";
import { PageCover } from "@/features/pages/cover";
import { CreatePageControl } from "@/features/pages/create-control";
import { FavoriteButton, MovePageForm, PageMetadataForm, TrashPageForm } from "@/features/pages/forms";
import { breadcrumbSchema, pageDetailSchema, pageSummarySchema } from "@/features/pages/model/validation";
import { PageList } from "@/features/pages/page-list";
import { childrenOf } from "@/features/pages/queries";
import { createClient, currentUser } from "@/lib/supabase/server";

export default async function PageDocument({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; pageId: string }>;
  searchParams: Promise<{ new?: string; afterPosition?: string; afterId?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { workspaceId, pageId } = await params;
  if (!uuidSchema.safeParse(workspaceId).success || !uuidSchema.safeParse(pageId).success) notFound();
  const client = await createClient();
  const { data, error } = await client.rpc("get_page_metadata", {
    p_page_id: pageId,
    p_workspace_id: workspaceId,
  });
  const raw = pageDetailSchema.nullable().parse(data);
  if (error) throw new Error("Não foi possível carregar a página.");
  if (!raw) notFound();
  const page = pageSummarySchema.parse(raw);
  const query = await searchParams;
  const [access, favorites, breadcrumbs, children, databaseResult] = await Promise.all([
    client.rpc("get_page_role", { p_page_id: pageId }),
    client
      .from("page_favorites")
      .select("page_id")
      .eq("page_id", pageId)
      .eq("user_id", user.id)
      .maybeSingle(),
    client.rpc("list_page_breadcrumbs", { p_page_id: pageId }),
    childrenOf(workspaceId, pageId, query.afterPosition, query.afterId),
    client.rpc("get_page_database", { p_page_id: pageId }),
  ]);
  if (access.error || breadcrumbs.error || favorites.error)
    throw new Error("Não foi possível carregar os detalhes da página.");
  const editable = access.data === "owner" || access.data === "editor";
  if (databaseResult.error) throw new Error("Não foi possível carregar os detalhes da base.");
  const database = z
    .strictObject({ databaseId: z.uuid(), isContainer: z.boolean(), isTemplate: z.boolean() })
    .nullable()
    .parse(databaseResult.data);
  const crumbs = z.array(breadcrumbSchema).parse(breadcrumbs.data);
  const last = children.items.at(-1);
  return (
    <div className="page-document">
      <BreadcrumbTrail
        workspaceId={workspaceId}
        pageId={pageId}
        initial={crumbs.slice(0, 50)}
        initialMore={crumbs.length > 50}
      />
      <PageCover
        pageId={pageId}
        coverFileId={raw.cover_file_id}
        revision={page.revision}
        editable={editable}
      />
      <div className="page-toolbar">
        <span className="notice">
          {editable
            ? "Você pode editar esta página"
            : access.data === "commenter"
              ? "Você pode ler e comentar"
              : "Somente leitura"}
        </span>
        <FavoriteButton
          key={`${pageId}-${Boolean(favorites.data)}`}
          pageId={pageId}
          workspaceId={workspaceId}
          initial={Boolean(favorites.data)}
        />
      </div>
      {editable ? (
        <>
          <h1 className="sr-only">{page.title || "Página sem título"}</h1>
          <PageMetadataForm page={page} workspaceId={workspaceId} focusTitle={query.new === "1"} />
        </>
      ) : (
        <h1 className="readonly-page-title">
          {page.icon && <span aria-hidden="true">{page.icon} </span>}
          {page.title || "Página sem título"}
        </h1>
      )}
      {database?.isContainer && <DatabaseClient databaseId={database.databaseId} workspaceId={workspaceId} />}
      {database && !database.isContainer && (
        <RecordProperties
          databaseId={database.databaseId}
          pageId={pageId}
          workspaceId={workspaceId}
          isTemplate={database.isTemplate}
        />
      )}
      <PageEditor
        key={pageId}
        userId={user.id}
        workspaceId={workspaceId}
        pageId={pageId}
        editable={editable}
      />
      <section className="page-children">
        <div className="section-heading">
          <h2>Subpáginas</h2>
          {editable && <CreatePageControl workspaceId={workspaceId} parentId={pageId} />}
          {editable && <CreateDatabaseControl workspaceId={workspaceId} parentId={pageId} />}
        </div>
        <PageList pages={children.items} workspaceId={workspaceId} canReorder={editable} />
        {children.more && last && (
          <Link
            className="pagination-link"
            href={`?${new URLSearchParams({ afterPosition: last.position, afterId: last.id })}`}
          >
            Próximas subpáginas
          </Link>
        )}
      </section>
      {editable && (
        <details className="page-organization">
          <summary>Organizar página</summary>
          <section className="section">
            <h2>Mover para outro lugar</h2>
            <MovePageForm key={pageId} page={page} workspaceId={workspaceId} />
          </section>
          <section className="section">
            <h2>Mover para a lixeira</h2>
            <TrashPageForm page={page} workspaceId={workspaceId} />
          </section>
        </details>
      )}
    </div>
  );
}
