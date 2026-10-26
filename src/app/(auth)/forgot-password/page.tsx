import { AuthForm } from "@/features/auth/auth-form";
export const metadata = { title: "Recuperar acesso" };
export default function ForgotPasswordPage() {
  return (
    <>
      <h1>Vamos recuperar seu acesso.</h1>
      <p>Informe seu e-mail para receber um link de redefinição de senha.</p>
      <AuthForm mode="forgot" />
    </>
  );
}
