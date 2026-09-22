import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Studio — Creative workspace",
  description:
    "Research your brand, create product ads, and make them your own.",
};
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
