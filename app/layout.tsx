import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegistration from "./sw-register";

export const metadata: Metadata = {
  title: "日報管理",
  description: "日報入力・管理システム",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "日報管理",
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        {/* iOS Safari: ホーム画面追加時のアイコン */}
        <link rel="apple-touch-icon" href="/icons/icon.svg" />
      </head>
      <body className="antialiased">
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
