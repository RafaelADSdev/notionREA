"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="workspace-main">
      <h1>Não conseguimos abrir agora.</h1>
      <p className="notice">Tente novamente. Se o problema continuar, saia e entre na sua conta.</p>
      <button type="button" className="button" onClick={reset} style={{ marginTop: 24 }}>
        Tentar novamente
      </button>
    </main>
  );
}
