import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bazak Copilot",
  description: "Your AI shopping copilot — find anything in the catalog in plain language.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-100 text-slate-800 font-sans min-h-screen antialiased">{children}</body>
    </html>
  );
}
