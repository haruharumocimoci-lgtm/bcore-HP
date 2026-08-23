"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/sync", { method: "POST" });
      const json = (await res.json()) as {
        courses?: number;
        videos?: number;
        error?: string;
      };
      if (!res.ok) {
        setMessage(`同期に失敗: ${json.error ?? res.status}`);
      } else {
        setMessage(`同期しました（講座 ${json.courses} 件・動画 ${json.videos} 件）`);
        router.refresh();
      }
    } catch {
      setMessage("通信に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn" onClick={sync} disabled={busy}>
        {busy ? "同期中…" : "Notionから同期"}
      </button>
      {message && <p style={{ marginTop: 10, fontSize: 13, color: "var(--text-dim)" }}>{message}</p>}
    </div>
  );
}
