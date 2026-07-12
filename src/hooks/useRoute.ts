import { useCallback, useEffect, useState } from "react";

export type Navigate = (to: string, options?: { replace?: boolean }) => void;

export function useRoute() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback<Navigate>((to, options) => {
    if (options?.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    setPathname(window.location.pathname);
  }, []);

  return { pathname, navigate };
}
