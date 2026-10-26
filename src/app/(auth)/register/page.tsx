import { AuthForm } from "@/features/auth/auth-form";
export const metadata = { title: "Criar conta" };
export default function RegisterPage() {
  return (
    <>
      <h1>Um lugar para suas ideias.</h1>
      <p>Crie sua conta. Vamos enviar um e-mail para confirmar que ela é sua.</p>
      <AuthForm mode="register" />
    </>
  );
}
