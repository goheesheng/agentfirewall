import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AgentFirewall",
  description: "Two locks before your agent signs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
