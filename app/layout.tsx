import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArogyaFlow | Care that stays in sync",
  description:
    "A reliable healthcare appointment, triage, and follow-up manager for patients, doctors, and clinic teams.",
  openGraph: {
    title: "ArogyaFlow | Care that stays in sync",
    description:
      "Conflict-safe booking, responsible AI briefs, and reliable follow-up in one calm workspace.",
  },
  twitter: {
    card: "summary_large_image",
    title: "ArogyaFlow | Care that stays in sync",
    description:
      "A thoughtful healthcare workflow from booking to follow-up.",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
