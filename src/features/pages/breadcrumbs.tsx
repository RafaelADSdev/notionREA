"use client";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";

import { breadcrumbSchema } from "./model/validation";
type Crumb = z.infer<typeof breadcrumbSchema>;
export function BreadcrumbTrail({
  workspaceId,
  pageId,
  initial,
  initialMore,
}: {
  workspaceId: string;
  pageId: string;
  initial: Crumb[];
  initialMore: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [more, setMore] = useState(initialMore);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <nav className="page-breadcrumbs" aria-label="Caminho da página">
      {more && (
        <button
          type="button"
          className="button quiet"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const response = await fetch(
                `/api/pages/breadcrumbs?${new URLSearchParams({ pageId, afterDepth: String(items.at(-1)?.depth ?? -1) })}`,
              );
              if (!response.ok) throw new Error("Unavailable");
              const result = z
                .object({ items: z.array(breadcrumbSchema).max(50), more: z.boolean() })
                .parse(await response.json());
              setItems([...items, ...result.items]);
              setMore(result.more);
              setError("");
            } catch {
              setError("Não foi possível carregar mais ancestrais.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Mais ancestrais
        </button>
      )}
      <ol>
        {items.toReversed().map((item) => (
          <li key={item.id}>
            {item.id === pageId ? (
              <span aria-current="page">{item.title || "Página sem título"}</span>
            ) : (
              <Link href={`/w/${workspaceId}/p/${item.id}`}>{item.title || "Página sem título"}</Link>
            )}
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
    </nav>
  );
}
