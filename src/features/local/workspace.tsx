"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brand, Icon } from "@/components/icon";
import { LocalPageEditor } from "@/features/editor/ui/page-editor";
import type { EditorSession } from "@/features/editor/client/editor-session";
import { between, rebalancePositions } from "@/features/editor/model/block-order";
import { LocaleProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/core";
import { LOCAL_USER_ID, LOCAL_WORKSPACE_ID, localOrder, type LocalPage } from "./model";
import {
  changeLocalPages,
  createLocalPage,
  exportLocalBackup,
  importLocalBackup,
  listLocalPages,
  LocalDocumentTransport,
  patchLocalPage,
  subscribeLocal,
} from "./store";
import { localText, type LocalText } from "./text";
import "./local.css";

type Filter = "all" | "favorites" | "trash";
const normal = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
function visiblePages(pages: LocalPage[]): { page: LocalPage; depth: number }[] {
  const result: { page: LocalPage; depth: number }[] = [];
  const map = new Map<string | null, LocalPage[]>();
  for (const page of pages) {
    const siblings = map.get(page.parentId) ?? [];
    siblings.push(page);
    map.set(page.parentId, siblings);
  }
  for (const siblings of map.values()) siblings.sort(localOrder);
  const stack = [...(map.get(null) ?? [])].reverse().map((page) => ({ page, depth: 0 }));
  while (stack.length) {
    const next = stack.pop();
    if (!next) continue;
    result.push(next);
    if (!next.page.trashed)
      stack.push(
        ...[...(map.get(next.page.id) ?? [])].reverse().map((page) => ({ page, depth: next.depth + 1 })),
      );
  }
  return result;
}
function pageHash(): string {
  const value = location.hash.slice(1);
  return /^[0-9a-f-]{36}$/.test(value) ? value : "";
}

export function LocalWorkspace() {
  const [locale, setLocale] = useState<Locale>("pt-BR");
  const [dark, setDark] = useState(false);
  const t = localText(locale);
  const [pages, setPages] = useState<LocalPage[]>([]),
    [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [filter, setFilter] = useState<Filter>("all"),
    [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const active = useRef<EditorSession | null>(null);
  const pending = useRef(new Set<Promise<unknown>>());
  const metadataErrors = useRef(new Map<string, Partial<Pick<LocalPage, "title" | "icon">>>());
  const metadataVersions = useRef(new Map<string, number>());
  const title = useRef<HTMLInputElement>(null),
    search = useRef<HTMLInputElement>(null),
    upload = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLButtonElement>(null),
    drawer = useRef<HTMLElement>(null);
  const selected = pages.find((page) => page.id === selectedId && !page.trashed);
  const drawerProps: React.HTMLAttributes<HTMLElement> = mobile ? { role: "dialog", "aria-modal": true } : {};
  const refresh = useCallback(async () => {
    const next = await listLocalPages();
    setPages(next.map((page) => ({ ...page, ...metadataErrors.current.get(page.id) })));
  }, []);
  const open = async () => {
    try {
      let preferredLocale: Locale = "pt-BR",
        preferredDark = false;
      try {
        preferredLocale = localStorage.getItem("bloco-local-locale") === "en" ? "en" : "pt-BR";
        preferredDark = localStorage.getItem("bloco-local-theme") === "dark";
      } catch {
        /* Preferences are optional. */
      }
      const next = await listLocalPages();
      setError("");
      setLocale(preferredLocale);
      setDark(preferredDark);
      setPages(next);
      setSelectedId(pageHash() || next.filter((page) => !page.trashed).sort(localOrder)[0]?.id || "");
    } catch {
      setError("storage");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let mounted = true;
    void listLocalPages().then(
      (next) => {
        if (!mounted) return;
        setPages(next);
        setSelectedId(pageHash() || next.filter((page) => !page.trashed).sort(localOrder)[0]?.id || "");
        try {
          setLocale(localStorage.getItem("bloco-local-locale") === "en" ? "en" : "pt-BR");
          setDark(localStorage.getItem("bloco-local-theme") === "dark");
        } catch {
          /* Preferences are optional. */
        }
        setLoading(false);
      },
      () => {
        if (mounted) {
          setError("storage");
          setLoading(false);
        }
      },
    );
    const unsubscribe = subscribeLocal(() => {
      void refresh().catch(() => setError("storage"));
      void active.current?.provider.synchronize();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [refresh]);
  useEffect(() => {
    if (loading) return;
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("bloco-local-locale", locale);
      localStorage.setItem("bloco-local-theme", dark ? "dark" : "light");
    } catch {
      /* Notes remain in IndexedDB even if preferences cannot be stored. */
    }
  }, [locale, dark, loading]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMobile(window.matchMedia("(max-width: 760px)").matches);
        search.current?.focus();
      }
      if (event.key === "Escape") {
        setMobile(false);
        requestAnimationFrame(() => menu.current?.focus());
      }
      if (mobile && event.key === "Tab") {
        const controls = [
          ...(drawer.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input,select,a[href]") ??
            []),
        ].filter((element) => element.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const hash = async () => {
      await Promise.all([...pending.current]);
      await active.current?.provider.flush();
      if (metadataErrors.current.size || active.current?.provider.hasPendingChanges()) {
        setError("unsaved");
        return;
      }
      setSelectedId(pageHash());
      setMobile(false);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current.size || metadataErrors.current.size) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("keydown", keyboard);
    window.addEventListener("hashchange", hash);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [mobile]);
  useEffect(() => {
    if (mobile) search.current?.focus();
  }, [mobile]);
  const onSession = useCallback((session: EditorSession) => {
    active.current = session;
  }, []);
  const mutate = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
      await refresh();
      return true;
    } catch {
      setError("save");
      return false;
    }
  };
  const rename = (id: string, patch: Partial<Pick<LocalPage, "title" | "icon">>) => {
    const desired = { ...metadataErrors.current.get(id), ...patch };
    const version = (metadataVersions.current.get(id) ?? 0) + 1;
    metadataErrors.current.set(id, desired);
    metadataVersions.current.set(id, version);
    setPages((previous) => previous.map((page) => (page.id === id ? { ...page, ...patch } : page)));
    const task = patchLocalPage(id, desired).then(
      () => {
        if (metadataVersions.current.get(id) === version) metadataErrors.current.delete(id);
      },
      () => {
        setError("save");
      },
    );
    pending.current.add(task);
    void task.finally(() => pending.current.delete(task));
  };
  const flush = async () => {
    while (pending.current.size) await Promise.all([...pending.current]);
    if (metadataErrors.current.size) {
      setError("save");
      return false;
    }
    await active.current?.provider.flush();
    if (active.current?.provider.hasPendingChanges()) {
      setError("unsaved");
      return false;
    }
    return true;
  };
  const choose = async (id: string) => {
    if (!(await flush())) return;
    setSelectedId(id);
    setMobile(false);
    history.replaceState(null, "", `#${id}`);
    requestAnimationFrame(() => title.current?.focus());
  };
  const add = async (parentId: string | null = null) => {
    if (!(await flush())) return;
    setBusy(true);
    try {
      const page = await createLocalPage(parentId);
      await refresh();
      await choose(page.id);
      setFilter("all");
      setQuery("");
    } catch {
      setError("save");
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (!selected || !(await flush())) return;
    if (await mutate(() => patchLocalPage(selected.id, { trashed: true }))) {
      setSelectedId("");
      active.current = null;
      history.replaceState(null, "", location.pathname);
    }
  };
  const move = async (id: string, direction: -1 | 1) => {
    await mutate(() =>
      changeLocalPages((current) => {
        const page = current.find((item) => item.id === id);
        if (!page) throw new Error("Page unavailable");
        const siblings = current
          .filter((item) => item.parentId === page.parentId && !item.trashed)
          .sort(localOrder);
        const index = siblings.findIndex((item) => item.id === id),
          destination = index + direction;
        if (destination < 0 || destination >= siblings.length) return current;
        siblings.splice(index, 1);
        siblings.splice(destination, 0, page);
        const position = between(
          siblings[destination - 1]?.position ?? null,
          siblings[destination + 1]?.position ?? null,
        );
        if (position) return current.map((item) => (item.id === id ? { ...item, position } : item));
        const positions = rebalancePositions(siblings.length),
          map = new Map(siblings.map((item, i) => [item.id, positions[i] ?? "V"]));
        return current.map((item) =>
          map.has(item.id) ? { ...item, position: map.get(item.id) ?? item.position } : item,
        );
      }),
    );
  };
  const backup = async () => {
    if (!(await flush())) return;
    setBusy(true);
    setMessage("");
    try {
      const text = await exportLocalBackup(),
        url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `bloco-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setMessage(t("backupDone"));
    } catch {
      setError("save");
    } finally {
      setBusy(false);
    }
  };
  const restore = async (file: File | undefined) => {
    if (!file || !(await flush())) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error("Size");
      await importLocalBackup(await file.text());
      await refresh();
      setMessage(t("importDone"));
    } catch {
      setError("import");
    } finally {
      setBusy(false);
      if (upload.current) upload.current.value = "";
    }
  };
  const allRows = visiblePages(pages),
    rows = (query ? allRows.filter((row) => normal(row.page.title).includes(normal(query))) : allRows).filter(
      ({ page }) =>
        filter === "trash" ? page.trashed : !page.trashed && (filter !== "favorites" || page.favorite),
    );
  return (
    <LocaleProvider locale={locale}>
      <div className="local-workspace">
        {mobile && (
          <button
            type="button"
            tabIndex={-1}
            className="local-backdrop"
            aria-label={t("close")}
            onClick={() => setMobile(false)}
          />
        )}
        <aside
          ref={drawer}
          className="local-sidebar"
          data-open={mobile}
          aria-label={t("pages")}
          {...drawerProps}
        >
          <Brand />
          <span className="local-badge">{t("local")}</span>
          <button
            className="button local-new-page"
            type="button"
            disabled={busy || loading}
            onClick={() => void add()}
          >
            <Icon name="plus" />
            {t("newPage")}
          </button>
          <input
            ref={search}
            type="search"
            placeholder={t("search")}
            aria-label={t("search")}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setLimit(100);
            }}
          />
          <fieldset className="local-filters" aria-label={t("pages")}>
            {(["all", "favorites", "trash"] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setLimit(100);
                }}
              >
                {t(value)}
              </button>
            ))}
          </fieldset>
          <nav aria-label={t("pages")} className="local-pages">
            {rows.slice(0, limit).map(({ page, depth }) => (
              <div className="local-page-row" key={page.id} style={{ paddingLeft: Math.min(depth, 8) * 12 }}>
                {page.trashed ? (
                  <>
                    <span>
                      {page.icon || "▤"} {page.title || t("untitled")}
                    </span>
                    <button
                      type="button"
                      aria-label={`${t("restore")}: ${page.title || t("untitled")}`}
                      onClick={() => void mutate(() => patchLocalPage(page.id, { trashed: false }))}
                    >
                      <Icon name="plus" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    aria-current={selectedId === page.id ? "page" : undefined}
                    onClick={() => void choose(page.id)}
                  >
                    <span aria-hidden="true">{page.icon || "▤"}</span>
                    <span>{page.title || t("untitled")}</span>
                    {page.favorite && <Icon name="star" size={14} />}
                  </button>
                )}
              </div>
            ))}
            {!rows.length && <p className="local-empty-list">{t("emptyList")}</p>}
            {rows.length > limit && (
              <button type="button" onClick={() => setLimit((value) => value + 100)}>
                +100
              </button>
            )}
          </nav>
          <div className="local-storage-actions">
            <button type="button" disabled={busy || loading} onClick={() => void backup()}>
              {t("backup")}
            </button>
            <button type="button" disabled={busy || loading} onClick={() => upload.current?.click()}>
              {t("import")}
            </button>
            <input
              hidden
              ref={upload}
              type="file"
              accept="application/json,.json"
              aria-label={t("import")}
              onChange={(event) => void restore(event.currentTarget.files?.[0])}
            />
            <p>{t("privacy")}</p>
          </div>
        </aside>
        <div className="local-main" inert={mobile}>
          <header className="local-topbar">
            <button
              ref={menu}
              className="icon-button local-menu"
              type="button"
              aria-label={t("menu")}
              aria-expanded={mobile}
              onClick={() => setMobile((value) => !value)}
            >
              <Icon name="more" />
            </button>
            <span>{selected?.title || "Bloco"}</span>
            <div>
              <label>
                {t("language")}
                <select
                  value={locale}
                  onChange={(event) => setLocale(event.currentTarget.value === "en" ? "en" : "pt-BR")}
                >
                  <option value="pt-BR">Português</option>
                  <option value="en">English</option>
                </select>
              </label>
              <button
                className="icon-button"
                type="button"
                aria-label={t("theme")}
                onClick={() => setDark((value) => !value)}
              >
                <Icon name={dark ? "moon" : "sun"} />
              </button>
            </div>
          </header>
          <main id="main" className="local-document">
            {error && (
              <div className="notice" role="alert">
                <p>
                  {t(
                    error === "storage"
                      ? "openFailed"
                      : error === "import"
                        ? "importFailed"
                        : error === "unsaved"
                          ? "unsaved"
                          : "saveFailed",
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (error === "storage") void open();
                    else {
                      for (const [id, patch] of metadataErrors.current) rename(id, patch);
                      void active.current?.provider.retry();
                      setError("");
                    }
                  }}
                >
                  {t("retry")}
                </button>
              </div>
            )}
            {message && (
              <p className="notice" role="status">
                {message}
              </p>
            )}
            {loading ? (
              <p role="status">{t("loading")}</p>
            ) : selected ? (
              <LocalDocumentView
                key={selected.id}
                page={selected}
                pages={pages}
                titleRef={title}
                t={t}
                onSession={onSession}
                rename={rename}
                mutate={mutate}
                archive={() => void archive()}
                addChild={() => void add(selected.id)}
                move={(direction) => void move(selected.id, direction)}
              />
            ) : (
              <div className="local-empty">
                <h1>{t("empty")}</h1>
                <p>{t("emptyBody")}</p>
                <button className="button" type="button" disabled={busy} onClick={() => void add()}>
                  {t("newPage")}
                </button>
              </div>
            )}
          </main>
        </div>
      </div>
    </LocaleProvider>
  );
}

function LocalDocumentView({
  page,
  pages,
  titleRef,
  t,
  onSession,
  rename,
  mutate,
  archive,
  addChild,
  move,
}: {
  page: LocalPage;
  pages: LocalPage[];
  titleRef: React.RefObject<HTMLInputElement | null>;
  t: LocalText;
  onSession: (session: EditorSession) => void;
  rename: (id: string, patch: Partial<Pick<LocalPage, "title" | "icon">>) => void;
  mutate: (action: () => Promise<unknown>) => Promise<boolean>;
  archive: () => void;
  addChild: () => void;
  move: (direction: -1 | 1) => void;
}) {
  const [transport] = useState(() => new LocalDocumentTransport(page.id));
  const [draftTitle, setTitle] = useState(page.title),
    [icon, setIcon] = useState(page.icon);
  return (
    <>
      <h1 className="local-sr-only">{draftTitle || t("untitled")}</h1>
      <div className="local-page-tools">
        <button
          type="button"
          aria-label={t(page.favorite ? "unfavorite" : "favorite")}
          aria-pressed={page.favorite}
          onClick={() => void mutate(() => patchLocalPage(page.id, { favorite: !page.favorite }))}
        >
          <Icon name="star" />
        </button>
        <button type="button" onClick={addChild}>
          {t("newChild")}
        </button>
        <label>
          {t("parent")}
          <select
            aria-label={t("parent")}
            value={page.parentId ?? ""}
            onChange={(event) =>
              void mutate(() => patchLocalPage(page.id, { parentId: event.currentTarget.value || null }))
            }
          >
            <option value="">{t("root")}</option>
            {pages
              .filter((item) => item.id !== page.id && !item.trashed)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title || t("untitled")}
                </option>
              ))}
          </select>
        </label>
        <button type="button" aria-label={t("moveUp")} onClick={() => move(-1)}>
          ↑
        </button>
        <button type="button" aria-label={t("moveDown")} onClick={() => move(1)}>
          ↓
        </button>
        <button type="button" aria-label={t("archive")} onClick={archive}>
          <Icon name="trash" />
        </button>
      </div>
      <input
        className="local-page-icon"
        aria-label={t("icon")}
        maxLength={16}
        placeholder="▤"
        value={icon}
        onChange={(event) => {
          setIcon(event.currentTarget.value);
          rename(page.id, { icon: event.currentTarget.value });
        }}
      />
      <input
        ref={titleRef}
        className="local-page-title"
        aria-label={t("title")}
        maxLength={500}
        placeholder={t("untitled")}
        value={draftTitle}
        onChange={(event) => {
          setTitle(event.currentTarget.value);
          rename(page.id, { title: event.currentTarget.value });
        }}
      />
      <LocalPageEditor
        userId={LOCAL_USER_ID}
        workspaceId={LOCAL_WORKSPACE_ID}
        pageId={page.id}
        editable
        transport={transport}
        onSession={onSession}
      />
    </>
  );
}
