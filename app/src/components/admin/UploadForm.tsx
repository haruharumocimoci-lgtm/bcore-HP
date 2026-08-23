"use client";

import { useState } from "react";

/**
 * 管理画面用: 動画をCloudflare Streamへ直接アップロードする。
 * 1. サーバーからアップロード専用URLをもらう（動画は自動で「署名付きURL必須」になる）
 * 2. ブラウザからそのURLへ動画ファイルを直接送る（このサーバーを経由しない）
 * 3. 表示された動画IDをNotionの動画台帳に貼り付けて「公開」にチェック
 */
export function UploadForm() {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [resultUid, setResultUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setResultUid(null);
    setProgressText("アップロード用URLを発行中…");

    try {
      const res = await fetch("/api/admin/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || file.name }),
      });
      const json = (await res.json()) as {
        uploadURL?: string;
        uid?: string;
        error?: string;
      };
      if (!res.ok || !json.uploadURL || !json.uid) {
        throw new Error(json.error || "アップロードURLの発行に失敗しました");
      }

      setProgressText("動画を送信中…（ファイルサイズによって数分かかります）");
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await fetch(json.uploadURL, { method: "POST", body: form });
      if (!uploadRes.ok) {
        throw new Error(
          `アップロードに失敗しました（${uploadRes.status}）。200MBを超える動画はCloudflareダッシュボードのStream画面からアップロードしてください。`
        );
      }

      setResultUid(json.uid);
      setProgressText(null);
      setName("");
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました");
      setProgressText(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={upload} className="card" style={{ maxWidth: 560 }}>
      <h3>動画をアップロード</h3>
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="video-name">動画の名前（Stream上の管理名）</label>
        <input
          id="video-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 打撃基礎 第1回"
        />
      </div>
      <div className="field">
        <label htmlFor="video-file">動画ファイル（〜200MB。それ以上はStream画面から）</label>
        <input
          id="video-file"
          type="file"
          accept="video/*"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {progressText && <p className="form-note">{progressText}</p>}
      {error && <p className="form-error">{error}</p>}
      {resultUid && (
        <p className="form-note">
          ✅ アップロード完了。動画ID: <code style={{ userSelect: "all" }}>{resultUid}</code>
          <br />
          このIDをNotionの動画台帳「動画ID」欄に貼り付け、「公開」にチェックを入れて
          「Notionから同期」してください。
        </p>
      )}

      <button className="btn" type="submit" disabled={busy || !file}>
        {busy ? "アップロード中…" : "アップロード"}
      </button>
    </form>
  );
}
