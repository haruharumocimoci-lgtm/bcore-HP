import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { checkEntitlement } from "@/lib/entitlement";
import { marketingSiteUrl } from "@/lib/env";
import { Paywall } from "@/components/Paywall";

export const metadata = { title: "マイページ" };
export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function AccountPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/account");

  const entitlement = await checkEntitlement(user.email);

  return (
    <div className="container">
      <div className="page-title">
        <h1>マイページ</h1>
      </div>

      <section className="section" style={{ maxWidth: 640 }}>
        <div className="card">
          <h3>アカウント</h3>
          <p style={{ WebkitLineClamp: "unset" }}>
            メールアドレス: <strong>{user.email}</strong>
          </p>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3>サブスクリプション</h3>
          {entitlement.entitled ? (
            <>
              <p style={{ WebkitLineClamp: "unset" }}>
                状態:{" "}
                <span className="badge badge--ok" style={{ marginTop: 0 }}>
                  有効（{entitlement.status}）
                </span>
                {entitlement.plan && <> ／ プラン: {entitlement.plan.toUpperCase()}</>}
              </p>
              {entitlement.cancelAtPeriodEnd ? (
                <p style={{ WebkitLineClamp: "unset" }}>
                  解約予約済みです。{formatDate(entitlement.currentPeriodEnd)}
                  まで視聴できます。
                </p>
              ) : (
                <p style={{ WebkitLineClamp: "unset" }}>
                  次回更新日: {formatDate(entitlement.currentPeriodEnd)}
                </p>
              )}
              <p style={{ WebkitLineClamp: "unset", marginTop: 12 }}>
                <a
                  href={`${marketingSiteUrl()}/#cancel`}
                  target="_blank"
                  rel="noopener"
                  style={{ textDecoration: "underline" }}
                >
                  お支払い方法の変更・解約のお手続きはこちら（公式HP）
                </a>
              </p>
            </>
          ) : (
            <Paywall loggedIn email={user.email} />
          )}
        </div>
      </section>
    </div>
  );
}
