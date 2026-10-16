import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SignalShift AI",
  description: "Consented voice continuity checks for live interviews.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
