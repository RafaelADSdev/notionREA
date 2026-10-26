import Link from "next/link";
import { Brand } from "@/components/icon";
import { Join } from "@/features/workspaces/join";
import { currentUser } from "@/lib/supabase/server";

export default async function JoinPage() {
  const user = await currentUser();
  return (
    <main id="main" className="auth-main" style={{ minHeight: "100svh" }}>
      <div className="auth-content">
        <Brand />
        <h1>Tem lugar para você.</h1>
        {user ? (
          <>
            <p>Confirme sua entrada no workspace. O convite precisa ter sido enviado para {user.email}.</p>
            <Join />
          </>
        ) : (
          <>
            <p>
              Entre com o e-mail convidado e confirmado. Depois, abra este link novamente para aceitar o
              convite.
            </p>
            <Link className="button" href="/login">
              Entrar no Bloco
            </Link>
            <p className="form-footer">
              <Link href="/register">Ainda não tenho conta</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
