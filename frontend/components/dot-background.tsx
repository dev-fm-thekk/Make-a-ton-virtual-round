// A quiet field of dots behind every screen. Pure CSS (a server component, no JavaScript, no images).
// The colour comes from a CSS variable (see globals.css), so light and dark mode need nothing here.

export function DotBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ backgroundImage: "radial-gradient(circle, var(--dot) 1.1px, transparent 1.6px)", backgroundSize: "26px 26px" }}
    />
  );
}
