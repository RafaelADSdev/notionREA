import Link from "next/link";
import { CreatePageControl } from "@/features/pages/create-control";
import { PageList } from "@/features/pages/page-list";
import { childrenOf } from "@/features/pages/queries";

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ afterPosition?: string; afterId?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const children = await childrenOf(workspaceId, null, query.afterPosition, query.afterId);
  const last = children.items.at(-1);
  return (
    <>
      <div className="document-heading">
        <h1>As suas páginas.</h1>
        <p>Um lugar para organizar suas ideias e encontrar o que importa.</p>
      </div>
      <div className="section-heading">
        <h2>Páginas no workspace</h2>
        <CreatePageControl workspaceId={workspaceId} />
      </div>
      <PageList pages={children.items} workspaceId={workspaceId} />
      {children.more && last && (
        <Link
          className="pagination-link"
          href={`?${new URLSearchParams({ afterPosition: last.position, afterId: last.id })}`}
        >
          Próximas páginas
        </Link>
      )}
      <footer className="page-home-footer">
        <p className="notice">Seu workspace também é um espaço para trabalhar em conjunto.</p>
        <Link href={`/w/${workspaceId}/members`}>Abrir equipe</Link>
      </footer>
    </>
  );
}
