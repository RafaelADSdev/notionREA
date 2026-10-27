import Link from "next/link";
import { CreateDatabaseControl } from "@/features/databases/create-control";
import { ImportExportControl } from "@/features/interchange/ui/import-export-control";
import { CreatePageControl } from "@/features/pages/create-control";
import { PageList } from "@/features/pages/page-list";
import { childrenOf } from "@/features/pages/queries";
import { getTranslations } from "@/lib/i18n/server";

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ afterPosition?: string; afterId?: string }>;
}) {
  const t = await getTranslations();

  const { workspaceId } = await params;
  const query = await searchParams;
  const children = await childrenOf(workspaceId, null, query.afterPosition, query.afterId);
  const last = children.items.at(-1);
  return (
    <>
      <div className="document-heading">
        <h1>{t("pages.yourPagesHeading")}</h1>
        <p>{t("pages.yourPagesDescription")}</p>
      </div>
      <div className="section-heading">
        <h2>{t("pages.inWorkspace")}</h2>
        <CreatePageControl workspaceId={workspaceId} />
        <CreateDatabaseControl workspaceId={workspaceId} />
        <ImportExportControl workspaceId={workspaceId} />
      </div>
      <PageList pages={children.items} workspaceId={workspaceId} />
      {children.more && last && (
        <Link
          className="pagination-link"
          href={`?${new URLSearchParams({ afterPosition: last.position, afterId: last.id })}`}
        >
          {t("pages.nextPages")}
        </Link>
      )}
      <footer className="page-home-footer">
        <p className="notice">{t("workspaces.collaborateNotice")}</p>
        <Link href={`/w/${workspaceId}/members`}>{t("workspaces.openTeam")}</Link>
      </footer>
    </>
  );
}
