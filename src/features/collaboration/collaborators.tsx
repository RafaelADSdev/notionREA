"use client";
import { useTranslations } from "@/lib/i18n/client";

import type { CollaborationSnapshot } from "./page-collaboration";
import "./collaboration.css";

export function Collaborators({ collaboration }: { collaboration: CollaborationSnapshot }) {
  const t = useTranslations();

  const { participants, connection, presenceAvailable } = collaboration;
  return (
    <aside className="collaborators" aria-label={t("collaboration.people")}>
      <p role="status">
        {connection === "denied"
          ? t("collaboration.denied")
          : connection === "connecting"
            ? t("collaboration.connecting")
            : connection === "catching-up"
              ? t("collaboration.polling")
              : !presenceAvailable
                ? t("collaboration.presenceUnavailable")
                : participants.length
                  ? t(participants.length === 1 ? "collaboration.onePerson" : "collaboration.manyPeople", {
                      count: participants.length,
                    })
                  : t("collaboration.alone")}
      </p>
      {participants.length > 0 && (
        <ul>
          {participants.map((participant) => (
            <li key={participant.participantId} data-participant-color={participant.color}>
              <span className="collaborator-dot" aria-hidden="true" />
              <span>{participant.label || t("common.member")}</span>
              {participant.cursor && (
                <span className="collaborator-position">{t("collaboration.sharedPosition")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
