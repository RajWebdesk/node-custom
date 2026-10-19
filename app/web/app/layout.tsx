import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Task & Approval (pilot prototype)",
  description: "Standalone Task & Approval Management. Pilot prototype, mock data only.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
