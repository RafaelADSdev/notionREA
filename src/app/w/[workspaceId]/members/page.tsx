import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { createClient, currentUser } from "@/lib/supabase/server";
import { InvitationForm, MemberForm } from "@/features/workspaces/forms";
import { uuidSchema } from "@/features/auth/validation";

export const metadata = { title: "Equipe" };
export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ afterTime?: string; afterId?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { workspaceId } = await params;
  const client = await createClient();
  const { data: membership } = await client
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) notFound();
  if (membership.role !== "owner")
    return (
      <div className="document-heading">
        <h1>Equipe.</h1>
        <p>
          Você participa deste workspace. Para convidar pessoas ou alterar acessos, fale com um administrador.
        </p>
      </div>
    );
  const cursor = await searchParams;
  const afterTime = z.iso.datetime({ offset: true }).safeParse(cursor.afterTime);
  const afterId = uuidSchema.safeParse(cursor.afterId);
  const paged = afterTime.success && afterId.success;
  const { data: members, error } = await client.rpc("list_workspace_members", {
    p_workspace_id: workspaceId,
    ...(paged ? { p_after_created_at: afterTime.data, p_after_user_id: afterId.data } : {}),
  });
  if (error) throw new Error("Não foi possível carregar a equipe.");
  const visible = members.slice(0, 50);
  const last = visible.at(-1);
  return (
    <>
      <div className="document-heading">
        <h1>Gente que constrói junto.</h1>
        <p>
          Gerencie quem participa do workspace. Cada página mantém suas próprias permissões; entrar na equipe
          não abre conteúdo privado.
        </p>
      </div>
      <section className="section">
        <h2>Convidar uma pessoa</h2>
        <InvitationForm workspaceId={workspaceId} />
        <p className="notice">
          O convite só pode ser aceito pela conta indicada, com e-mail confirmado. Um novo convite invalida o
          anterior.
        </p>
      </section>
      <section className="section">
        <h2>Membros</h2>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Pessoas e permissões no workspace</caption>
            <thead>
              <tr>
                <th scope="col">Pessoa</th>
                <th scope="col">Acesso</th>
                <th scope="col">Gerenciar</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((member) => (
                <tr key={member.user_id}>
                  <td>
                    {member.email}
                    {member.user_id === user.id && <span className="notice"> (você)</span>}
                  </td>
                  <td>
                    <span className="pill">{member.role === "owner" ? "Administrador" : "Membro"}</span>
                  </td>
                  <td>
                    <MemberForm
                      workspaceId={workspaceId}
                      userId={member.user_id}
                      email={member.email}
                      role={member.role}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav className="form-links" aria-label="Páginas da equipe">
          {paged && <Link href={`/w/${workspaceId}/members`}>Primeiros membros</Link>}
          {members.length > 50 && last && (
            <Link
              href={`/w/${workspaceId}/members?${new URLSearchParams({ afterTime: last.created_at, afterId: last.user_id })}`}
            >
              Próximos membros
            </Link>
          )}
        </nav>
        <p className="notice">
          Mantenha sempre pelo menos um administrador. Administradores podem gerenciar todo o conteúdo do
          workspace.
        </p>
      </section>
    </>
  );
}
