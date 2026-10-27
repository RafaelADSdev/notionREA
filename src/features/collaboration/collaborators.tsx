"use client";
import type { CollaborationSnapshot } from "./page-collaboration";
import "./collaboration.css";

export function Collaborators({ collaboration }: { collaboration: CollaborationSnapshot }) {
  const { participants, connection, presenceAvailable } = collaboration;
  return (
    <aside className="collaborators" aria-label="Pessoas nesta página">
      <p role="status">
        {connection === "denied"
          ? "Colaboração indisponível: acesso encerrado."
          : connection === "connecting"
            ? "Conectando colaboração…"
            : connection === "catching-up"
              ? "Verificando alterações periodicamente."
              : !presenceAvailable
                ? "Presença temporariamente indisponível."
                : participants.length
                  ? `${participants.length} outra${participants.length === 1 ? " pessoa" : "s pessoas"} nesta página.`
                  : "Nenhuma outra pessoa conectada nesta página."}
      </p>
      {participants.length > 0 && (
        <ul>
          {participants.map((participant) => (
            <li key={participant.participantId} data-participant-color={participant.color}>
              <span className="collaborator-dot" aria-hidden="true" />
              <span>{participant.label}</span>
              {participant.cursor && <span className="collaborator-position">com posição compartilhada</span>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
