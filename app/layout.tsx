import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "日報管理",
  description: "日報入力・管理システム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
