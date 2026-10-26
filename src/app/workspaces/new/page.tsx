import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/icon";
import { WorkspaceForm } from "@/features/workspaces/forms";
import { currentUser } from "@/lib/supabase/server";

export const metadata = { title: "Criar workspace" };
export default async function NewWorkspacePage() {
  if (!(await currentUser())) redirect("/login");
  return (
    <main id="main" className="auth-main" style={{ minHeight: "100svh" }}>
      <div className="auth-content">
        <Link href="/" aria-label="Bloco, início">
          <Brand />
        </Link>
        <h1>Seu próximo espaço começa aqui.</h1>
        <p>Dê um nome ao lugar onde você vai reunir ideias e pessoas.</p>
        <WorkspaceForm requestId={randomUUID()} />
        <p className="form-footer">
          <Link href="/workspaces">Ver meus workspaces</Link>
        </p>
      </div>
    </main>
  );
}
