import { SignJWT, importJWK, type JWK } from "jose";
import { env } from "@/lib/env";

/**
 * Cloudflare Stream まわりの処理。
 *
 * 動画はすべて「署名付きURL必須（requireSignedURLs: true）」でアップロードする。
 * 再生時はこのサーバーが短命のトークン（既定2時間）を発行し、
 * それが無いと動画のURLを直接開いても再生できない。
 * → 生の動画URLの共有・ダウンロードを防ぐ。
 */

const CF_API = "https://api.cloudflare.com/client/v4";

function accountId(): string {
  return env("CLOUDFLARE_ACCOUNT_ID");
}
function apiToken(): string {
  return env("STREAM_API_TOKEN");
}

export function streamCustomerCode(): string {
  return env("STREAM_CUSTOMER_CODE");
}

export function streamConfigured(): boolean {
  return Boolean(env("STREAM_SIGNING_KEY_ID") && env("STREAM_SIGNING_KEY_JWK") && streamCustomerCode());
}

/**
 * 動画1本分の再生トークン（署名付きJWT）を作る。
 * Stream の署名キー（POST /stream/keys で作成したもの）で署名する。
 */
export async function createPlaybackToken(
  videoUid: string,
  lifetimeSeconds = 2 * 60 * 60
): Promise<string> {
  const keyId = env("STREAM_SIGNING_KEY_ID");
  const jwkBase64 = env("STREAM_SIGNING_KEY_JWK");
  if (!keyId || !jwkBase64) {
    throw new Error("STREAM_SIGNING_KEY_ID / STREAM_SIGNING_KEY_JWK が設定されていません");
  }

  const jwk = JSON.parse(
    new TextDecoder().decode(Uint8Array.from(atob(jwkBase64), (c) => c.charCodeAt(0)))
  ) as JWK;
  const key = await importJWK(jwk, "RS256");

  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    sub: videoUid,
    kid: keyId,
    // ダウンロード禁止（signed URL でのMP4ダウンロードを許可しない）
    downloadable: false,
    accessRules: [{ type: "any", action: "allow" }],
  })
    .setProtectedHeader({ alg: "RS256", kid: keyId })
    .setExpirationTime(now + lifetimeSeconds)
    .sign(key);
}

/** 再生用のiframe埋め込みURL（トークン込み） */
export function playbackIframeUrl(token: string): string {
  return `https://customer-${streamCustomerCode()}.cloudflarestream.com/${token}/iframe`;
}

/**
 * 管理画面用: ブラウザから直接アップロードできるURLを発行する。
 * 発行された uploadURL に動画ファイルを送ると、Stream に取り込まれる。
 * requireSignedURLs を必ず true にする（署名なしでは再生できない動画になる）。
 */
export async function createDirectUpload(meta: { name?: string } = {}): Promise<{
  uploadURL: string;
  uid: string;
}> {
  const res = await fetch(`${CF_API}/accounts/${accountId()}/stream/direct_upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      maxDurationSeconds: 6 * 60 * 60,
      requireSignedURLs: true,
      meta: meta.name ? { name: meta.name } : undefined,
    }),
  });
  const json = (await res.json()) as {
    success: boolean;
    errors?: { message: string }[];
    result?: { uploadURL: string; uid: string };
  };
  if (!res.ok || !json.success || !json.result) {
    throw new Error(
      `Streamのアップロード用URLを発行できませんでした: ${json.errors?.[0]?.message || res.status}`
    );
  }
  return json.result;
}

export type StreamVideo = {
  uid: string;
  name: string;
  readyToStream: boolean;
  requireSignedURLs: boolean;
  duration: number;
  created: string;
  thumbnail: string;
};

/** 管理画面用: Stream にある動画の一覧 */
export async function listStreamVideos(): Promise<StreamVideo[]> {
  const res = await fetch(`${CF_API}/accounts/${accountId()}/stream?asc=false`, {
    headers: { Authorization: `Bearer ${apiToken()}` },
  });
  const json = (await res.json()) as {
    success: boolean;
    result?: Array<{
      uid: string;
      meta?: { name?: string };
      readyToStream?: boolean;
      requireSignedURLs?: boolean;
      duration?: number;
      created?: string;
      thumbnail?: string;
    }>;
  };
  if (!res.ok || !json.success || !json.result) return [];
  return json.result.map((v) => ({
    uid: v.uid,
    name: v.meta?.name || "(名称未設定)",
    readyToStream: Boolean(v.readyToStream),
    requireSignedURLs: Boolean(v.requireSignedURLs),
    duration: v.duration ?? 0,
    created: v.created ?? "",
    thumbnail: v.thumbnail ?? "",
  }));
}

/** 管理画面用: 既存動画に「署名付きURL必須」を強制する（設定漏れの修正用） */
export async function enforceSignedUrls(videoUid: string): Promise<void> {
  await fetch(`${CF_API}/accounts/${accountId()}/stream/${videoUid}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requireSignedURLs: true }),
  });
}
