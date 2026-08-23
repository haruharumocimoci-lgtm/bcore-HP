import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { checkEntitlement } from "@/lib/entitlement";
import { getVideo } from "@/lib/content";
import { createPlaybackToken, playbackIframeUrl, streamConfigured } from "@/lib/stream";

/**
 * 動画の再生トークンを発行する。
 * - ログイン済みで、有効なサブスク会員のみ（無料サンプル動画はログインのみでOK）
 * - トークンは2時間で失効する短命の署名付きJWT
 * - 生の動画URLは返さない
 */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  let body: { videoId?: string };
  try {
    body = (await request.json()) as { videoId?: string };
  } catch {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }
  if (!body.videoId) {
    return NextResponse.json({ error: "videoId が必要です" }, { status: 400 });
  }

  const video = await getVideo(body.videoId);
  if (!video || !video.published || !video.stream_uid) {
    return NextResponse.json({ error: "動画が見つかりません" }, { status: 404 });
  }

  if (!video.free_preview) {
    const entitlement = await checkEntitlement(user.email);
    if (!entitlement.entitled) {
      return NextResponse.json(
        { error: "有効なサブスクリプションがありません", code: "not_subscribed" },
        { status: 403 }
      );
    }
  }

  if (!streamConfigured()) {
    return NextResponse.json(
      { error: "動画配信の設定が完了していません（管理者にお問い合わせください）" },
      { status: 503 }
    );
  }

  const token = await createPlaybackToken(video.stream_uid);
  return NextResponse.json({
    iframeUrl: playbackIframeUrl(token),
    expiresInSeconds: 2 * 60 * 60,
  });
}
