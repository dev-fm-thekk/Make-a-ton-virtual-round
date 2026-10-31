import { redirect } from "next/navigation";

// The app shell decides whether to show the dashboard or bounce to /login.
export const instant = false; // see the note in app/layout.tsx

export default function Home() {
  redirect("/dashboard");
}
