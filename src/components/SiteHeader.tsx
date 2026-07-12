import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import type { AuthSession } from "../services/auth";
import type { Navigate } from "../hooks/useRoute";

type SiteHeaderProps = {
  session: AuthSession | null;
  pathname: string;
  navigate: Navigate;
  signingOut: boolean;
  onSignOut: () => void;
};

function SiteHeader({ session, pathname, navigate, signingOut, onSignOut }: SiteHeaderProps) {
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuOpen = menuPath === pathname;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuPath(null);
      menuButtonRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  const go = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setMenuPath(null);
    navigate(path);
  };

  return (
    <header className="site-header">
      <a className="brand" href="/" onClick={go("/")} aria-label="Modu Brain 홈">
        <span className="brand-mark" aria-hidden="true">M</span>
        <span>Modu Brain</span>
      </a>
      <button
        ref={menuButtonRef}
        className="nav-menu-button"
        type="button"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        onClick={() => setMenuPath((current) => current === pathname ? null : pathname)}
      >
        <span className="nav-menu-icon" aria-hidden="true"><i /><i /><i /></span>
        메뉴
      </button>
      <nav id={menuId} className={menuOpen ? "menu-open" : ""} aria-label="주요 메뉴">
        <a
          aria-current={pathname === "/" ? "page" : undefined}
          className={pathname === "/" ? "active" : ""}
          href="/"
          onClick={go("/")}
        >
          소개
        </a>
        <a
          aria-current={pathname === "/demo" ? "page" : undefined}
          className={pathname === "/demo" ? "active" : ""}
          href="/demo"
          onClick={go("/demo")}
        >
          공개 데모
        </a>
        {session ? (
          <>
            <a
              aria-current={pathname.startsWith("/projects") ? "page" : undefined}
              className={pathname.startsWith("/projects") ? "active" : ""}
              href="/projects"
              onClick={go("/projects")}
            >
              프로젝트
            </a>
            <button className="nav-action" type="button" disabled={signingOut} onClick={onSignOut}>
              {signingOut ? "로그아웃 중…" : "로그아웃"}
            </button>
          </>
        ) : (
          <a
            aria-current={pathname === "/login" ? "page" : undefined}
            className={pathname === "/login" ? "active" : ""}
            href="/login"
            onClick={go("/login")}
          >
            로그인
          </a>
        )}
      </nav>
    </header>
  );
}

export default SiteHeader;
