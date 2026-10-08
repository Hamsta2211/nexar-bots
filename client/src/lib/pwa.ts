import { useEffect, useState } from "react";

// Installation als App (PWA). Das Install-Ereignis kann vor dem Start von React kommen,
// deshalb fängt index.html es in window.__nexarInstall ab.
export function useInstall() {
  const [evt, setEvt] = useState<any>(() => (window as any).__nexarInstall || null);
  const [installed, setInstalled] = useState(
    () => !!window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true,
  );
  useEffect(() => {
    const on = (e: any) => { e.preventDefault(); (window as any).__nexarInstall = e; setEvt(e); };
    const done = () => { setInstalled(true); setEvt(null); };
    window.addEventListener("beforeinstallprompt", on);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", on);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const install = async () => {
    if (!evt) return;
    try { evt.prompt(); await evt.userChoice; } catch {}
    (window as any).__nexarInstall = null;
    setEvt(null);
  };
  return { installed, canPrompt: !!evt, ios, install };
}
