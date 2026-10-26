"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { pageListSchema, type PageList, type PageSummary } from "./model/validation";

type TreeRow = { page: PageSummary; depth: number };
export function PageTree({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate?: (path: string) => void;
}) {
  const pathname = usePathname();
  const [groups, setGroups] = useState<Record<string, PageList>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const root = "root";
  async function load(parent: string, next = false) {
    setBusy(parent);
    const params = new URLSearchParams({ workspaceId });
    if (parent !== root) params.set("parentId", parent);
    const last = next ? groups[parent]?.items.at(-1) : undefined;
    if (last) {
      params.set("afterPosition", last.position);
      params.set("afterId", last.id);
    }
    try {
      const response = await fetch(`/api/pages?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const result = pageListSchema.parse(await response.json());
      setGroups((current) => ({
        ...current,
        [parent]: {
          ...result,
          items: next ? [...(current[parent]?.items ?? []), ...result.items] : result.items,
        },
      }));
      setError("");
    } catch {
      setError("Não foi possível carregar a árvore. Tente novamente.");
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/pages?${new URLSearchParams({ workspaceId })}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unavailable");
        const list = pageListSchema.parse(await response.json());
        setGroups((current) => ({ ...current, root: list }));
        if (pathname.includes("/p/"))
          requestAnimationFrame(() =>
            document.querySelector('.page-tree a[aria-current="page"]')?.scrollIntoView({ block: "nearest" }),
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Não foi possível carregar as páginas.");
      });
    return () => controller.abort();
  }, [workspaceId, pathname]);
  // Flatten iteratively: deeply nested pages never recurse through React components.
  const rows: TreeRow[] = [];
  const stack: TreeRow[] = [...(groups[root]?.items ?? [])].reverse().map((page) => ({ page, depth: 0 }));
  const seen = new Set<string>();
  while (stack.length) {
    const row = stack.pop();
    if (!row || seen.has(row.page.id)) continue;
    seen.add(row.page.id);
    rows.push(row);
    if (expanded.has(row.page.id))
      for (const page of [...(groups[row.page.id]?.items ?? [])].reverse())
        stack.push({ page, depth: row.depth + 1 });
  }
  return (
    <nav aria-label="Árvore de páginas" className="page-tree">
      <ul>
        {rows.map(({ page, depth }) => (
          <li key={page.id} style={{ paddingInlineStart: Math.min(depth, 12) * 10 }}>
            <div className="tree-row">
              <button
                type="button"
                className="tree-expand"
                aria-expanded={expanded.has(page.id)}
                aria-label={`${expanded.has(page.id) ? "Recolher" : "Expandir"} ${page.title || "Página sem título"}`}
                disabled={busy === page.id}
                onClick={() => {
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(page.id)) next.delete(page.id);
                    else next.add(page.id);
                    return next;
                  });
                  if (!expanded.has(page.id)) void load(page.id);
                }}
              >
                <Icon name="chevron" size={14} />
              </button>
              <Link
                href={`/w/${workspaceId}/p/${page.id}`}
                onClick={() => onNavigate?.(`/w/${workspaceId}/p/${page.id}`)}
                aria-current={pathname.endsWith(`/p/${page.id}`) ? "page" : undefined}
              >
                <span aria-hidden="true">{page.icon || <Icon name="document" size={16} />}</span>
                <span>{page.title || "Página sem título"}</span>
              </Link>
            </div>
            {expanded.has(page.id) && groups[page.id]?.more && (
              <button
                type="button"
                className="tree-more"
                disabled={busy !== ""}
                onClick={() => void load(page.id, true)}
              >
                Mais subpáginas de {page.title || "página sem título"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {groups[root]?.more && (
        <button
          type="button"
          className="tree-more"
          disabled={busy !== ""}
          onClick={() => void load(root, true)}
        >
          Mais páginas
        </button>
      )}
      {error && (
        <p role="alert" className="notice">
          {error}{" "}
          <button type="button" onClick={() => void load(root)}>
            Recarregar
          </button>
        </p>
      )}
    </nav>
  );
}
