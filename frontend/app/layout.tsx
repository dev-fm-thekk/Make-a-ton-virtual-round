import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Brightloop Billing", template: "%s · Brightloop Billing" },
  description: "Subscription management, recurring billing and revenue reporting.",
};

// Next's dev-time "instant navigation" check wants every segment to prerender a meaningful static shell.
// This app can't: who is signed in lives in memory + an httpOnly cookie, so every screen renders after a
// client-side session check (see lib/auth.tsx). Opt the whole app out once, here, instead of per segment
// The opt-out is per segment (it does not inherit), so each page.tsx / layout.tsx repeats the one-liner.
// Without it, every route logs a "Could not validate instant navigation" error in dev.
export const instant = false;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
