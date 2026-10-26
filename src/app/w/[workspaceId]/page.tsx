import Link from "next/link";
import { Icon } from "@/components/icon";

export default async function WorkspacePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return (
    <>
      <div className="document-heading">
        <h1>Há espaço para boas ideias.</h1>
        <p>Este workspace é um ponto de encontro para o que você e sua equipe querem construir.</p>
      </div>
      <section className="welcome-sheet">
        <div className="welcome-emblem">
          <Icon name="layers" size={54} />
        </div>
        <h2>Comece pelas pessoas.</h2>
        <p>
          Abra a equipe para ver quem está por aqui. Se você administra este espaço, pode convidar outras
          pessoas e organizar os acessos.
        </p>
        <Link className="button" href={`/w/${workspaceId}/members`}>
          Abrir equipe
          <Icon name="arrow" size={18} />
        </Link>
      </section>
    </>
  );
}
