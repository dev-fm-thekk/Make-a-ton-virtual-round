// Light / dark mode. The choice lives in localStorage; with none stored we follow the operating system.
// THEME_SCRIPT runs in <head> before first paint (see app/layout.tsx), so there is never a flash of the wrong theme.

export type Theme = "light" | "dark";

const KEY = "theme";

export const THEME_SCRIPT = `(function(){var d=document.documentElement,t;try{t=localStorage.getItem("${KEY}")}catch(e){}if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.theme=t})()`;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function stored(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null; // private window or blocked storage: the choice just won't persist
  }
}

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  notify();
}

export const getTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* not persisted */
  }
  apply(t);
}

/** For useSyncExternalStore. Also follows live OS changes while the person has not picked a side. */
export function subscribeTheme(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    if (!stored()) apply(mq.matches ? "dark" : "light");
  };
  mq.addEventListener("change", onSystem);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", onSystem);
  };
}
