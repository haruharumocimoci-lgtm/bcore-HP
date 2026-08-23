import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { marketingSiteUrl } from "@/lib/env";

export const metadata: Metadata = {
  title: {
    default: "B-CORE FORM | 会員限定 動画レッスン",
    template: "%s | B-CORE FORM",
  },
  description:
    "野球塾 B-CORE のサブスク会員限定 動画視聴プラットフォーム。講座ごとに整理されたレッスン動画をいつでも視聴できます。",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <footer className="site-footer">
          <div className="container">
            <p>
              © B-CORE ／{" "}
              <a href={marketingSiteUrl()} target="_blank" rel="noopener">
                公式ホームページ
              </a>{" "}
              ／{" "}
              <a href={`${marketingSiteUrl()}/#cancel`} target="_blank" rel="noopener">
                解約のお手続き
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
