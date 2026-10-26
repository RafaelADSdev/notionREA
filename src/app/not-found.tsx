import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="workspace-main">
      <h1>Este espaço não está disponível.</h1>
      <p className="notice">O endereço pode ter mudado ou sua conta não tem acesso.</p>
      <Link className="button" href="/" style={{ marginTop: 24 }}>
        Voltar ao início
      </Link>
    </main>
  );
}
