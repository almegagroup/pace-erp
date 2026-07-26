import { useEffect } from "react";
import { useLocation } from "react-router-dom";

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

export default function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
