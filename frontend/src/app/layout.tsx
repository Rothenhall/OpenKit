import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Jost } from "next/font/google";
import "./globals.css";

const display = Jost({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const sans = Instrument_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Sales Call Trainer, a free Rothenhall tool",
  description:
    "Paste your website, practise the pitch against an AI buyer in your language, and get scored on what closes deals.",
};

export const viewport: Viewport = {
  themeColor: "#f7f3ea",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} h-full antialiased`}
    >
      <body className="flex h-dvh flex-col overflow-hidden">{children}</body>
    </html>
  );
}
