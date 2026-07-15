import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mathesis",
  description:
    "Leitor local com dicionários, corpus literário, anotações e exportação.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Mathesis",
  },
  icons: {
    icon: [
      { url: "/mathesis-icon.svg", type: "image/svg+xml" },
      { url: "/mathesis-icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: [{ url: "/mathesis-icon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#f4efe7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
