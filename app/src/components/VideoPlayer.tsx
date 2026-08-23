"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 動画プレイヤー。
 * サーバーから短命の再生トークン（署名付きURL）をもらってiframeで再生する。
 * トークンは2時間で失効するため、失効前に自動で取り直す。
 */
export function VideoPlayer({ videoId }: { videoId: string }) {
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchToken = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/stream/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      const json = (await res.json()) as {
        iframeUrl?: string;
        expiresInSeconds?: number;
        error?: string;
      };
      if (!res.ok || !json.iframeUrl) {
        setError(json.error || "再生の準備に失敗しました。");
        return;
      }
      setIframeUrl(json.iframeUrl);

      // 失効10分前に取り直す
      const refreshMs = Math.max(((json.expiresInSeconds ?? 7200) - 600) * 1000, 60_000);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fetchToken, refreshMs);
    } catch {
      setError("通信に失敗しました。時間をおいてお試しください。");
    }
  }, [videoId]);

  useEffect(() => {
    fetchToken();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchToken]);

  return (
    <div className="player-wrap">
      {iframeUrl ? (
        <iframe
          src={iframeUrl}
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
          allowFullScreen
          title="動画プレイヤー"
        />
      ) : (
        <div className="player-message">
          {error ? (
            <>
              <p>{error}</p>
              <button className="btn btn--sm" onClick={fetchToken}>
                再読み込み
              </button>
            </>
          ) : (
            <p>読み込み中…</p>
          )}
        </div>
      )}
    </div>
  );
}
