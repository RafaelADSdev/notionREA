import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand, Icon } from "@/components/icon";
import { createClient, currentUser } from "@/lib/supabase/server";
import { uuidSchema } from "@/features/auth/validation";

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string }>;
}) {
  if (!(await currentUser())) redirect("/login");
  const client = await createClient();
  const after = (await searchParams).after;
  let query = client.from("workspaces").select("id,name").order("id").limit(51);
  if (after && uuidSchema.safeParse(after).success) query = query.gt("id", after);
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar workspaces.");
  const visible = data.slice(0, 50);
  return (
    <main id="main" className="workspace-main">
      <Link href="/" aria-label="Bloco, início">
        <Brand />
      </Link>
      <div className="document-heading" style={{ marginTop: 52 }}>
        <h1>Seus workspaces.</h1>
        <p>Escolha onde quer trabalhar agora.</p>
      </div>
      <nav className="nav-list" aria-label="Workspaces">
        {visible.map((item) => (
          <Link key={item.id} href={`/w/${item.id}`} className="nav-link">
            <Icon name="layers" />
            {item.name}
            <Icon name="arrow" />
          </Link>
        ))}
      </nav>
      {!visible.length && <p className="notice">Você ainda não participa de um workspace.</p>}
      <div className="form-links">
        <Link className="button" href="/workspaces/new">
          Criar workspace
        </Link>
        {data.length > 50 && (
          <Link href={`/workspaces?after=${visible.at(-1)?.id}`}>Próximos workspaces</Link>
        )}
      </div>
    </main>
  );
}
