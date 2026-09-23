import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geist = localFont({ src: "../assets/fonts/Geist-Regular.ttf", display: "swap", variable: "--font-geist" });
export const metadata: Metadata = {
  title: "ads-maxxing — creative workspace",
  description:
    "Research your store, create product ads, and refine every creative.",
};
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
