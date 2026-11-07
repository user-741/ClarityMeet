// Root layout, wraps all pages with ThemeProvider (dark/light) and ClientLayout (sidebar or plain).

import type { Metadata } from "next";
import "./globals.css";
import ClientLayout from "./components/ClientLayout";
import { ThemeProvider } from "./components/ThemeProvider";

export const metadata: Metadata = {
  title: "ClarityMeet - AI Meeting Intelligence",
  description: "Transform meeting chaos into structured action. AI-powered transcription, summaries, and task automation for modern B2B teams.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <ThemeProvider>
          <ClientLayout>{children}</ClientLayout>
        </ThemeProvider>
      </body>
    </html>
  );
}