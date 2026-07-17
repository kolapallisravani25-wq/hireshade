import Link from "next/link";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HireShade Job Agent",
  description: "Verified, role-aware job discovery and controlled application automation.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="site-header">
          <Link className="brand" href="/">HireShade</Link>
          <nav aria-label="Primary navigation">
            <Link href="/pricing">Pricing</Link>
          </nav>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
