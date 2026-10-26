import { redirect } from "next/navigation";
import { AuthForm } from "@/features/auth/auth-form";
import { currentUser } from "@/lib/supabase/server";
import { getEnvironment } from "@/lib/env";
import { safeRedirect } from "@/features/auth/validation";

export const metadata = { title: "Entrar" };
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; status?: string }>;
}) {
  if (await currentUser()) redirect("/");
  const query = await searchParams;
  return (
    <>
      <h1>Bom ter você aqui.</h1>
      <p>Entre no seu espaço e continue de onde parou.</p>
      {query.status === "callback-error" && (
        <p role="alert" className="form-feedback error">
          Este link não pôde ser confirmado. Solicite outro ou entre com sua senha.
        </p>
      )}
      <AuthForm
        mode="login"
        next={safeRedirect(query.next ?? null)}
        googleEnabled={getEnvironment().GOOGLE_AUTH_ENABLED === "true"}
      />
    </>
  );
}
