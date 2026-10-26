"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Brand, Icon } from "@/components/icon";
import { signOut } from "@/features/auth/actions";

type Workspace = { id: string; name: string };
export function WorkspaceShell({
  workspace,
  workspaces,
  email,
  isOwner,
  children,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  email: string;
  isOwner: boolean;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebar = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const home = `/w/${workspace.id}`;
  const isMembers = path.endsWith("/members");
  function closeMobile() {
    sidebar.current?.close();
    setMobileOpen(false);
    menu.current?.focus();
  }
  useEffect(() => {
    if (mobileOpen) sidebar.current?.showModal();
  }, [mobileOpen]);
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
        <Link
          className="nav-link"
          href={home}
          aria-current={!isMembers ? "page" : undefined}
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
        <form action={signOut}>
          <button
            type="submit"
            className="nav-link"
            style={{ width: "100%", border: 0, background: "transparent" }}
          >
            <Icon name="exit" />
            Sair
          </button>
        </form>
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
              <span>{isMembers ? "Equipe" : "Página inicial"}</span>
            </div>
          </div>
          <span className="workspace-label">Um espaço em construção conjunta.</span>
        </header>
        <main id="main" className="workspace-main">
          {children}
        </main>
      </div>
    </div>
  );
}
