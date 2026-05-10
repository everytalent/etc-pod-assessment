import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ETC Assessment",
  description:
    "Conversational vetting for Solar Tech and BD candidates joining the ETC POD network.",
};

// Explicit mobile-first viewport. width=device-width respects the phone's
// own width (no zoom-out), initialScale=1 keeps the page at CSS pixel
// density, viewportFit=cover lets the page extend into iOS safe areas.
// We deliberately leave maximumScale unset so users can pinch-zoom for
// accessibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fffadb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
