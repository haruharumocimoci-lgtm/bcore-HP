import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { notionConfigured } from "@/lib/notion";
import { streamConfigured } from "@/lib/stream";
import { SyncButton } from "@/components/admin/SyncButton";

export const dynamic = "force-dynamic";

async function count(table: string): Promise<number> {
  try {
    const admin = createSupabaseAdminClient();
    const { count } = await admin.from(table).select("*", { count: "exact", head: true });
    return count ?? 0;
  } catch {
    return 0;
  }
}

export default async function AdminDashboard() {
  const admin = createSupabaseAdminClient();
  const [coursesCount, videosCount, activeCount, syncState] = await Promise.all([
    count("courses"),
    count("videos"),
    admin
      .from("subscriptions")
      .select("*", { count: "exact", head: true })
      .in("status", ["active", "trialing"])
      .eq("is_test", false)
      .then((r) => r.count ?? 0),
    admin.from("sync_state").select("last_synced_at").eq("id", 1).maybeSingle(),
  ]);

  const checks: Array<{ name: string; ok: boolean; hint: string }> = [
    {
      name: "Supabase 接続",
      ok: Boolean(env("NEXT_PUBLIC_SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY")),
      hint: "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
    },
    {
      name: "Stripe Webhook",
      ok: Boolean(env("STRIPE_WEBHOOK_SECRET") || env("STRIPE_WEBHOOK_SECRET_TEST")),
      hint: "STRIPE_WEBHOOK_SECRET",
    },
    {
      name: "Cloudflare Stream（署名付き再生）",
      ok: streamConfigured(),
      hint: "STREAM_SIGNING_KEY_ID / STREAM_SIGNING_KEY_JWK / STREAM_CUSTOMER_CODE",
    },
    {
      name: "Stream アップロードAPI",
      ok: Boolean(env("CLOUDFLARE_ACCOUNT_ID") && env("STREAM_API_TOKEN")),
      hint: "CLOUDFLARE_ACCOUNT_ID / STREAM_API_TOKEN",
    },
    {
      name: "Notion 台帳",
      ok: notionConfigured(),
      hint: "NOTION_TOKEN / NOTION_COURSES_DB_ID / NOTION_VIDEOS_DB_ID",
    },
  ];

  return (
    <section className="section">
      <div className="grid" style={{ marginBottom: 32 }}>
        <div className="card">
          <h3>有効会員数</h3>
          <p style={{ fontSize: 28, fontWeight: 800, color: "var(--text)" }}>{activeCount}</p>
        </div>
        <div className="card">
          <h3>講座 / 動画</h3>
          <p style={{ fontSize: 28, fontWeight: 800, color: "var(--text)" }}>
            {coursesCount} / {videosCount}
          </p>
        </div>
        <div className="card">
          <h3>Notion同期</h3>
          <p style={{ color: "var(--text)" }}>
            最終同期:{" "}
            {syncState.data?.last_synced_at
              ? new Date(syncState.data.last_synced_at).toLocaleString("ja-JP")
              : "未実行"}
          </p>
          <div style={{ marginTop: 12 }}>
            <SyncButton />
          </div>
        </div>
      </div>

      <h2>設定状況</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>項目</th>
              <th>状態</th>
              <th>必要な環境変数</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.ok ? "✅ 設定済み" : "⚠️ 未設定"}</td>
                <td style={{ color: "var(--text-dim)" }}>{c.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
