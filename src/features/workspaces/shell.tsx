"use client";
import dynamic from "next/dynamic";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Brand, Icon } from "@/components/icon";
import { SafeSignOut } from "@/features/editor/ui/safe-sign-out";
import { CreatePageControl } from "@/features/pages/create-control";
import { PageTree } from "@/features/pages/page-tree";
import { PageSearch } from "@/features/pages/search";
import { useTranslations } from "@/lib/i18n/client";

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
  const t = useTranslations();

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
    ? t("navigation.team")
    : path.endsWith("/favorites")
      ? t("navigation.favorites")
      : path.endsWith("/trash")
        ? t("navigation.trash")
        : path.includes("/p/")
          ? t("navigation.pages")
          : t("navigation.home");
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
        <Link href={home} aria-label={t("navigation.brandHome")}>
          <Brand />
        </Link>
        <button
          type="button"
          className="icon-button mobile-menu"
          onClick={closeMobile}
          aria-label={t("navigation.close")}
        >
          <Icon name="menu" />
        </button>
      </div>
      <div className="workspace-choice">
        <label htmlFor="workspace-picker">{t("navigation.yourWorkspace")}</label>
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
      <nav className="nav-list" aria-label={t("navigation.main")}>
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
          {t("navigation.home")}
        </Link>
        <Link
          className="nav-link"
          href={`${home}/members`}
          aria-current={isMembers ? "page" : undefined}
          onClick={() => setMobileOpen(false)}
        >
          <Icon name="people" />
          {t("navigation.team")}
        </Link>
      </nav>
      <nav className="nav-list" aria-label={t("navigation.organization")}>
        <Link
          className="nav-link"
          href={`${home}/favorites`}
          aria-current={path.endsWith("/favorites") ? "page" : undefined}
          onClick={() => setMobileOpen(false)}
        >
          <Icon name="star" />
          {t("navigation.favorites")}
        </Link>
        <Link
          className="nav-link"
          href={`${home}/trash`}
          aria-current={path.endsWith("/trash") ? "page" : undefined}
          onClick={() => setMobileOpen(false)}
        >
          <Icon name="trash" />
          {t("navigation.trash")}
        </Link>
      </nav>
      <section className="sidebar-section page-navigation" aria-label={t("navigation.workspacePages")}>
        <h2>{t("navigation.yourPages")}</h2>
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
        <h2>{t("navigation.yourSpaces")}</h2>
        <Link className="nav-link" href="/workspaces/new">
          <Icon name="plus" />
          {t("navigation.newWorkspace")}
        </Link>
        <Link className="nav-link" href="/workspaces">
          {t("navigation.viewWorkspaces")}
        </Link>
      </div>
      <div className="sidebar-bottom">
        <div className="identity">
          <span className="avatar">{email.slice(0, 1).toUpperCase()}</span>
          <div className="identity-text">
            <strong>{isOwner ? t("common.administrator") : t("common.member")}</strong>
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
          aria-label={t("navigation.workspaceNavigation")}
          onCancel={(event) => {
            event.preventDefault();
            closeMobile();
          }}
        >
          {navigation}
        </dialog>
      ) : (
        <aside id="workspace-navigation" className="sidebar" aria-label={t("navigation.workspaceNavigation")}>
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
              aria-label={collapsed ? t("navigation.expand") : t("navigation.collapse")}
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
              aria-label={t("navigation.open")}
            >
              <Icon name="menu" />
            </button>
            <div className="breadcrumb">
              <Link href={home}>{workspace.name}</Link>
              <span aria-hidden="true">/</span>
              <span>{label}</span>
            </div>
          </div>
          <span className="workspace-label">{t("navigation.collaborationTagline")}</span>
        </header>
        <PendingDrafts userId={userId} />
        <main id="main" ref={main} tabIndex={-1} className="workspace-main">
          {children}
        </main>
      </div>
    </div>
  );
}
