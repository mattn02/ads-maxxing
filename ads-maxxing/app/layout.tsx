import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Product ad workflow test",
  description: "Local URL to image workflow prototype",
};
export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en"><body>{children}</body></html>;
}
