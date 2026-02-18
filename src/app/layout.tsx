import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home Brain",
  description: "Local-first Chat UI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* IMPORTANT: no bg-* class here */}
      <body className="min-h-screen text-zinc-50">
        {children}
      </body>
    </html>
  );
}