import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { membersDb } from "@/lib/env";

export const dynamic = "force-dynamic";

type Row = {
  email: string | null;
  plan: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  source: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP");
}

export default async function AdminMembersPage() {
  const admin = createSupabaseAdminClient();
  const rows: Row[] = [];

  // Supabase側（このサイトのWebhookが更新）
  const { data: supaRows } = await admin
    .from("subscriptions")
    .select("email, plan, status, current_period_end, cancel_at_period_end")
    .eq("is_test", false)
    .order("current_period_end", { ascending: false });
  for (const r of supaRows ?? []) {
    rows.push({ ...r, cancel_at_period_end: Boolean(r.cancel_at_period_end), source: "Supabase" });
  }

  // D1側（既存のWebhook Workerが更新）— Supabaseに無い契約だけ足す
  try {
    const db = membersDb();
    if (db) {
      const d1 = await db
        .prepare(
          `SELECT id, email, plan, status, current_period_end, cancel_at_period_end
             FROM subscriptions WHERE is_test = 0 ORDER BY current_period_end DESC`
        )
        .all<{
          id: string;
          email: string | null;
          plan: string | null;
          status: string;
          current_period_end: number | null;
          cancel_at_period_end: number | null;
        }>();
      const known = new Set(rows.map((r) => r.email).filter(Boolean));
      for (const r of d1.results) {
        if (r.email && known.has(r.email)) continue;
        rows.push({
          email: r.email,
          plan: r.plan,
          status: r.status,
          current_period_end: r.current_period_end
            ? new Date(r.current_period_end * 1000).toISOString()
            : null,
          cancel_at_period_end: Boolean(r.cancel_at_period_end),
          source: "D1",
        });
      }
    }
  } catch (err) {
    console.error("D1の読み取りに失敗:", err);
  }

  const activeCount = rows.filter((r) => ["active", "trialing"].includes(r.status)).length;

  return (
    <section className="section">
      <p style={{ marginBottom: 16, color: "var(--text-dim)" }}>
        有効会員 <strong style={{ color: "var(--text)" }}>{activeCount}</strong> 名 ／ 全契約{" "}
        {rows.length} 件（本番のみ・テストデータ除く）
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>メールアドレス</th>
              <th>プラン</th>
              <th>状態</th>
              <th>期間の終わり</th>
              <th>解約予約</th>
              <th>記録元</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: "var(--text-dim)" }}>
                  契約データがまだありません。
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.email ?? "（メール未取得）"}</td>
                  <td>{r.plan?.toUpperCase() ?? "—"}</td>
                  <td>
                    {["active", "trialing"].includes(r.status) ? `✅ ${r.status}` : r.status}
                  </td>
                  <td>{formatDate(r.current_period_end)}</td>
                  <td>{r.cancel_at_period_end ? "あり" : "—"}</td>
                  <td>{r.source}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
