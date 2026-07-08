import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mathesis",
  description:
    "Leitor local com dicionários, corpus literário, anotações e exportação.",
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
