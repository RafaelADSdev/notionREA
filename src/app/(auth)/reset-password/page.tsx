import { AuthForm } from "@/features/auth/auth-form";
export const metadata = { title: "Nova senha" };
export default function ResetPasswordPage() {
  return (
    <>
      <h1>Escolha uma nova senha.</h1>
      <p>Use uma combinação exclusiva para proteger seu espaço.</p>
      <AuthForm mode="reset" />
    </>
  );
}
