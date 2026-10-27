"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Brand, Icon } from "@/components/icon";
import { SafeSignOut } from "@/features/editor/ui/safe-sign-out";
import { PageSearch } from "@/features/pages/search";
import { PageTree } from "@/features/pages/page-tree";
import { CreatePageControl } from "@/features/pages/create-control";
import dynamic from "next/dynamic";

const PendingDrafts = dynamic(() =>
  import("@/features/editor/ui/pending-drafts").then((module) => module.PendingDrafts),
);

type Workspace = { id: string; name: string };
export function WorkspaceShell({
  workspace,
  workspaces,
  email,
  userId,
  isOwner,
  children,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  email: string;
  userId: string;
  isOwner: boolean;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebar = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const focusDestination = useRef<string | null>(null);
  const [searchNavigation, setSearchNavigation] = useState(0);
  const home = `/w/${workspace.id}`;
  const isMembers = path.endsWith("/members");
  useEffect(() => {
    let active = true;
    void import("@/features/editor/client/editor-session").then((module) => {
      if (active) module.clearOtherEditorSessions(userId);
    });
    return () => {
      active = false;
    };
  }, [userId]);
  const label = isMembers
    ? "Equipe"
    : path.endsWith("/favorites")
      ? "Favoritos"
      : path.endsWith("/trash")
        ? "Lixeira"
        : path.includes("/p/")
          ? "Páginas"
          : "Página inicial";
  function closeMobile() {
    sidebar.current?.close();
    setMobileOpen(false);
    menu.current?.focus();
  }
  useEffect(() => {
    if (mobileOpen) sidebar.current?.showModal();
  }, [mobileOpen]);
  useEffect(() => {
    if (searchNavigation > 0 && focusDestination.current === path) {
      main.current?.focus();
      focusDestination.current = null;
    }
  }, [path, searchNavigation]);
  useEffect(() => {
    const viewport = window.matchMedia("(min-width: 801px)");
    const onResize = () => {
      if (viewport.matches) setMobileOpen(false);
    };
    viewport.addEventListener("change", onResize);
    return () => viewport.removeEventListener("change", onResize);
  }, []);
  const navigation = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link href={home} aria-label="Bloco, página inicial">
          <Brand />
        </Link>
        <button
          type="button"
          className="icon-button mobile-menu"
          onClick={closeMobile}
          aria-label="Fechar navegação"
        >
          <Icon name="menu" />
        </button>
      </div>
      <div className="workspace-choice">
        <label htmlFor="workspace-picker">Seu workspace</label>
        <select
          id="workspace-picker"
          value={workspace.id}
          onChange={(event) => {
            setMobileOpen(false);
            router.push(`/w/${event.target.value}`);
          }}
        >
          {workspaces.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <nav className="nav-list" aria-label="Principal">
        <PageSearch
          key={workspace.id}
          workspaceId={workspace.id}
          onNavigate={(destination) => {
            focusDestination.current = destination;
            closeMobile();
            setSearchNavigation((value) => value + 1);
          }}
        />
        <Link
          className="nav-link"
          href={home}
          aria-current={path === home ? "page" : undefined}
          onClick={() => setMobileOpen(false)}
        >
          <Icon name="home" />
          Página inicial
        </Link>
        <Link
          className="nav-link"
          href={`${home}/members`}
          aria-current={isMembers ? "page" : undefined}
          onClick={() => setMobileOpen(false)}
        >
          <Icon name="people" />
          Equipe
        </Link>
      </nav>
      <nav className="nav-list" aria-label="Organização">
        <Link
          className="nav-link"
          href={`${home}/favorites`}
          aria-current={path.endsWith("/favorites") ? "page" : undefined}
          onClick={() => setMobileOpen(false)}
        >
          <Icon name="star" />
          Favoritos
        </Link>
        <Link
          className="nav-link"
          href={`${home}/trash`}
          aria-current={path.endsWith("/trash") ? "page" : undefined}
          onClick={() => setMobileOpen(false)}
        >
          <Icon name="trash" />
          Lixeira
        </Link>
      </nav>
      <section className="sidebar-section page-navigation" aria-label="Páginas do workspace">
        <h2>Suas páginas</h2>
        <CreatePageControl compact workspaceId={workspace.id} onNavigate={closeMobile} />
        <PageTree
          key={workspace.id}
          workspaceId={workspace.id}
          onNavigate={(destination) => {
            focusDestination.current = destination;
            closeMobile();
            setSearchNavigation((value) => value + 1);
          }}
        />
      </section>
      <div className="sidebar-section">
        <h2>Seus espaços</h2>
        <Link className="nav-link" href="/workspaces/new">
          <Icon name="plus" />
          Novo workspace
        </Link>
        <Link className="nav-link" href="/workspaces">
          Ver workspaces
        </Link>
      </div>
      <div className="sidebar-bottom">
        <div className="identity">
          <span className="avatar">{email.slice(0, 1).toUpperCase()}</span>
          <div className="identity-text">
            <strong>{isOwner ? "Administrador" : "Membro"}</strong>
            {email}
          </div>
        </div>
        <SafeSignOut key={userId} userId={userId} />
      </div>
    </>
  );
  return (
    <div className={`workspace${collapsed ? " is-collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}>
      {mobileOpen ? (
        <dialog
          id="workspace-navigation"
          ref={sidebar}
          className="sidebar"
          aria-label="Navegação do workspace"
          onCancel={(event) => {
            event.preventDefault();
            closeMobile();
          }}
        >
          {navigation}
        </dialog>
      ) : (
        <aside id="workspace-navigation" className="sidebar" aria-label="Navegação do workspace">
          {navigation}
        </aside>
      )}
      <div className="main-panel">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              type="button"
              className="icon-button desktop-menu"
              onClick={() => setCollapsed(!collapsed)}
              aria-controls="workspace-navigation"
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expandir navegação" : "Recolher navegação"}
            >
              <Icon name="menu" />
            </button>
            <button
              ref={menu}
              type="button"
              className="icon-button mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-expanded={mobileOpen}
              aria-controls="workspace-navigation"
              aria-label="Abrir navegação"
            >
              <Icon name="menu" />
            </button>
            <div className="breadcrumb">
              <Link href={home}>{workspace.name}</Link>
              <span aria-hidden="true">/</span>
              <span>{label}</span>
            </div>
          </div>
          <span className="workspace-label">Um espaço em construção conjunta.</span>
        </header>
        <PendingDrafts userId={userId} />
        <main id="main" ref={main} tabIndex={-1} className="workspace-main">
          {children}
        </main>
      </div>
    </div>
  );
}
