import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { listStreamVideos } from "@/lib/stream";
import { UploadForm } from "@/components/admin/UploadForm";
import { SyncButton } from "@/components/admin/SyncButton";

export const dynamic = "force-dynamic";

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}分${s.toString().padStart(2, "0")}秒`;
}

export default async function AdminVideosPage() {
  const admin = createSupabaseAdminClient();
  const streamReady = Boolean(env("CLOUDFLARE_ACCOUNT_ID") && env("STREAM_API_TOKEN"));

  const [streamVideos, { data: mirrorVideos }] = await Promise.all([
    streamReady ? listStreamVideos() : Promise.resolve([]),
    admin
      .from("videos")
      .select("id, title, stream_uid, published, free_preview, courses(title)")
      .order("sort_order", { ascending: true }),
  ]);

  const usedUids = new Set(
    (mirrorVideos ?? []).map((v) => v.stream_uid).filter(Boolean) as string[]
  );

  return (
    <section className="section">
      <div className="notice">
        動画公開までの流れ: ①ここで動画をアップロード → ②表示された動画IDを
        Notionの動画台帳「動画ID」欄に貼る → ③台帳の「公開」にチェック →
        ④「Notionから同期」ボタンを押す（10分以内に自動でも反映されます）
      </div>

      {streamReady ? <UploadForm /> : (
        <div className="notice">
          アップロード機能を使うには CLOUDFLARE_ACCOUNT_ID と STREAM_API_TOKEN
          の設定が必要です。設定するまでは、CloudflareダッシュボードのStream画面から
          アップロードして動画IDをNotionに貼ってください。
        </div>
      )}

      <h2 style={{ marginTop: 40, marginBottom: 16 }}>サイトに登録済みの動画（Notion台帳）</h2>
      <div style={{ marginBottom: 16 }}>
        <SyncButton />
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>タイトル</th>
              <th>講座</th>
              <th>動画ID</th>
              <th>公開</th>
              <th>無料サンプル</th>
            </tr>
          </thead>
          <tbody>
            {(mirrorVideos ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} style={{ color: "var(--text-dim)" }}>
                  まだ動画がありません。Notionの動画台帳に行を追加して同期してください。
                </td>
              </tr>
            ) : (
              (mirrorVideos ?? []).map((v) => (
                <tr key={v.id}>
                  <td>{v.title}</td>
                  <td>
                    {(v.courses as unknown as { title?: string } | null)?.title ?? "—"}
                  </td>
                  <td style={{ fontFamily: "monospace" }}>{v.stream_uid || "（未設定）"}</td>
                  <td>{v.published ? "✅" : "—"}</td>
                  <td>{v.free_preview ? "✅" : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {streamReady && (
        <>
          <h2 style={{ marginTop: 40, marginBottom: 16 }}>Cloudflare Stream 上の動画</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>名前</th>
                  <th>動画ID</th>
                  <th>長さ</th>
                  <th>状態</th>
                  <th>署名必須</th>
                  <th>台帳登録</th>
                </tr>
              </thead>
              <tbody>
                {streamVideos.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ color: "var(--text-dim)" }}>
                      Streamに動画がありません。
                    </td>
                  </tr>
                ) : (
                  streamVideos.map((v) => (
                    <tr key={v.uid}>
                      <td>{v.name}</td>
                      <td style={{ fontFamily: "monospace", userSelect: "all" }}>{v.uid}</td>
                      <td>{formatDuration(v.duration)}</td>
                      <td>{v.readyToStream ? "✅ 配信可" : "⏳ 変換中"}</td>
                      <td>{v.requireSignedURLs ? "✅" : "⚠️ 保護なし"}</td>
                      <td>{usedUids.has(v.uid) ? "✅" : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
