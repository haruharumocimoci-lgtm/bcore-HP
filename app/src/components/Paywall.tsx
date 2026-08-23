import Link from "next/link";
import { env, marketingSiteUrl } from "@/lib/env";

/**
 * 未契約・解約済みの人に見せる案内。
 * 決済はこのサイトでは行わず、Stripeの支払いリンク（既存HPと同じもの）へ誘導する。
 * ログイン中のメールアドレスを prefilled_email としてStripeのチェックアウトに渡すことで、
 * 「決済メール = 会員登録メール」の紐付けがずれないようにする。
 */
export function Paywall({ loggedIn, email }: { loggedIn: boolean; email?: string | null }) {
  const linkOnline = env("STRIPE_LINK_ONLINE");
  const linkOffline = env("STRIPE_LINK_OFFLINE");

  const withEmail = (link: string) =>
    email ? `${link}${link.includes("?") ? "&" : "?"}prefilled_email=${encodeURIComponent(email)}` : link;

  return (
    <div className="paywall">
      <h2>動画の視聴にはサブスク契約が必要です</h2>
      {loggedIn ? (
        <>
          <p>
            プランにお申し込みください。
            <br />
            決済画面では<strong>このサイトに登録したメールアドレス（{email ?? "登録メール"}）と同じもの</strong>
            をご利用ください。決済が完了すると自動で視聴できるようになります。
          </p>
          {linkOnline || linkOffline ? (
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              {linkOnline && (
                <a href={withEmail(linkOnline)} className="btn" target="_blank" rel="noopener">
                  ONLINEプランに申し込む
                </a>
              )}
              {linkOffline && (
                <a href={withEmail(linkOffline)} className="btn" target="_blank" rel="noopener">
                  OFFLINEプランに申し込む
                </a>
              )}
            </div>
          ) : (
            <a
              href={`${marketingSiteUrl()}/#price`}
              className="btn"
              target="_blank"
              rel="noopener"
            >
              プランを見る（公式HP）
            </a>
          )}
        </>
      ) : (
        <>
          <p>まずは会員登録（無料）のうえ、プランにお申し込みください。</p>
          <Link href="/signup" className="btn">
            無料で会員登録
          </Link>
        </>
      )}
    </div>
  );
}
