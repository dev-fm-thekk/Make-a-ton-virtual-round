import type { NextConfig } from "next";

// The browser only ever talks to this Next.js origin. /api/v1/* is proxied to the Express API,
// so the httpOnly refresh cookie is first-party (works in dev and prod with no CORS / SameSite pain).
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    // Dev-only experiment from the project template. It runs an "instant navigation" audit on every page load and
    // floods the terminal with errors that can't apply to an app whose screens render after a client-side session
    // check; its floating badge also covers the sidebar's Sign out button. Turn it back on to try it.
    agentFeedback: false,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${BACKEND_URL}/api/v1/:path*` }];
  },
};

export default nextConfig;
