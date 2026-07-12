import { useEffect, useRef, useState } from "react";
import SiteHeader from "./components/SiteHeader";
import { useRoute } from "./hooks/useRoute";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import ProjectPage from "./pages/ProjectPage";
import ProjectsPage from "./pages/ProjectsPage";
import SharePage from "./pages/SharePage";
import {
  authService as defaultAuthService,
  type AuthService,
  type AuthSession,
} from "./services/auth";
import {
  AUTH_REQUIRED_EVENT,
  platformApi as defaultPlatformApi,
  type PlatformApi,
} from "./services/platformApi";

const SESSION_REFRESH_LEAD_MS = 60_000;

type AppProps = {
  auth?: AuthService;
  api?: PlatformApi;
};

function App({ auth = defaultAuthService, api = defaultPlatformApi }: AppProps) {
  const { pathname, navigate } = useRoute();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const hasRenderedRoute = useRef(false);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const callbackSession = await auth.consumeCallback(window.location.hash);
        const nextSession = callbackSession ?? await auth.restoreSession();
        if (!active) return;
        setSession(nextSession);
        if (callbackSession) {
          window.history.replaceState(null, "", "/projects");
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      } catch (error) {
        if (active) setAuthError(error instanceof Error ? error.message : "로그인을 완료하지 못했습니다.");
      } finally {
        if (active) setAuthReady(true);
      }
    };
    void restore();
    return () => { active = false; };
  }, [auth]);

  useEffect(() => {
    if (!session) return undefined;
    let active = true;
    const refreshDelay = Math.max(
      0,
      session.expiresAt - Date.now() - SESSION_REFRESH_LEAD_MS,
    );
    const timer = window.setTimeout(() => {
      void auth
        .refreshSession(session)
        .then((refreshed) => {
          if (active) setSession(refreshed);
        })
        .catch(() => {
          if (!active) return;
          setSession(null);
          setAuthError("로그인 세션을 갱신하지 못했습니다. 다시 로그인해 주세요.");
          if (pathname.startsWith("/projects")) navigate("/login");
        });
    }, refreshDelay);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [auth, navigate, pathname, session]);

  useEffect(() => {
    const handleAuthRequired = () => {
      setSession(null);
      setAuthError("로그인 세션이 만료되었습니다. 새 로그인 링크를 요청해 주세요.");
      if (window.location.pathname.startsWith("/projects")) navigate("/login");
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
  }, [navigate]);

  useEffect(() => {
    if (!hasRenderedRoute.current) {
      hasRenderedRoute.current = true;
      return;
    }
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [pathname]);

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setAuthError(null);
    try {
      await auth.signOut(session);
      setSession(null);
      navigate("/");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "로그아웃을 완료하지 못했습니다.");
    } finally {
      setSigningOut(false);
    }
  };

  let page: React.ReactNode;
  if (pathname === "/") {
    page = <LandingPage key="landing" navigate={navigate} />;
  } else if (pathname === "/demo") {
    page = <LandingPage key="public-demo" navigate={navigate} initialDemo />;
  } else if (pathname === "/login") {
    page = session ? <AlreadySignedIn email={session.user.email} onContinue={() => navigate("/projects")} /> : <LoginPage auth={auth} onGuestContinue={() => navigate("/demo")} />;
  } else if (pathname === "/share") {
    page = <SharePage api={api} />;
  } else if (pathname === "/projects") {
    page = authReady ? (session ? <ProjectsPage api={api} token={session.accessToken} navigate={navigate} onAccountDeleted={() => { setSession(null); navigate("/"); }} /> : <LoginRequired onLogin={() => navigate("/login")} onGuestContinue={() => navigate("/demo")} />) : <AuthLoader />;
  } else {
    const projectMatch = pathname.match(/^\/projects\/([^/]+)$/);
    page = projectMatch
      ? authReady
        ? session
          ? <ProjectPage api={api} token={session.accessToken} projectId={decodeURIComponent(projectMatch[1])} navigate={navigate} />
          : <LoginRequired onLogin={() => navigate("/login")} onGuestContinue={() => navigate("/demo")} />
        : <AuthLoader />
      : <NotFound navigate={() => navigate("/")} />;
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      <SiteHeader session={session} pathname={pathname} navigate={navigate} signingOut={signingOut} onSignOut={() => void signOut()} />
      {authError && <div className="global-notice notice error" role="alert">{authError}<button type="button" onClick={() => setAuthError(null)}>닫기</button></div>}
      <div id="main-content" tabIndex={-1}>
        {page}
      </div>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div><strong>Modu Brain</strong><p>결정을 요약하는 것을 넘어, 근거와 변화를 연결합니다.</p></div>
          <nav aria-label="하단 메뉴">
            <a href="/demo">로그인 없이 체험</a>
            <a href="/login">프로젝트 저장 시작</a>
          </nav>
        </div>
      </footer>
    </>
  );
}

function AuthLoader() {
  return <main className="app-page"><div className="loading-card page-loader" role="status">로그인 상태를 확인하는 중…</div></main>;
}

function LoginRequired({ onLogin, onGuestContinue }: { onLogin: () => void; onGuestContinue: () => void }) {
  return <main className="narrow-page"><section className="auth-card"><p className="section-kicker">Saved workspace</p><h1>저장할 때만 로그인하세요</h1><p>공개 체험은 계정 없이 사용할 수 있고, 저장 프로젝트와 원문만 계정별로 안전하게 격리됩니다.</p><div className="auth-choice-row"><button className="button primary" type="button" onClick={onLogin}>이메일로 로그인</button><button className="button secondary" type="button" onClick={onGuestContinue}>공개 데모 계속</button></div></section></main>;
}

function AlreadySignedIn({ email, onContinue }: { email: string; onContinue: () => void }) {
  return <main className="narrow-page"><section className="auth-card"><p className="section-kicker">Signed in</p><h1>이미 로그인되어 있습니다</h1><p>{email || "현재 계정"}으로 프로젝트를 계속할 수 있습니다.</p><button className="button primary" type="button" onClick={onContinue}>프로젝트로 이동</button></section></main>;
}

function NotFound({ navigate }: { navigate: () => void }) {
  return <main className="narrow-page"><section className="auth-card"><p className="section-kicker">404</p><h1>페이지를 찾을 수 없습니다</h1><p>주소가 변경되었거나 존재하지 않는 경로입니다.</p><button className="button secondary" type="button" onClick={navigate}>홈으로 돌아가기</button></section></main>;
}

export default App;
