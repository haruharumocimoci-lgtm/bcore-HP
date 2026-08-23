import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * 環境変数の読み出し。
 * Cloudflare Workers 上では「変数とシークレット」が env に入り、
 * ローカル開発では process.env（.env.local / .dev.vars）に入る。
 * どちらでも同じコードで読めるようにする。
 */
export function env(name: string): string {
  const fromProcess = process.env[name];
  if (typeof fromProcess === "string" && fromProcess.trim()) {
    return fromProcess.trim();
  }
  try {
    const cf = getCloudflareContext().env as Record<string, unknown>;
    const value = cf[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // ビルド時など Cloudflare コンテキストが無い場面では無視する
  }
  return "";
}

/** 既存の会員データベース（D1）。バインドされていない環境では null */
export function membersDb(): D1Database | null {
  try {
    const cf = getCloudflareContext().env as { MEMBERS_DB?: D1Database };
    return cf.MEMBERS_DB ?? null;
  } catch {
    return null;
  }
}

export function adminEmails(): string[] {
  return env("ADMIN_EMAILS")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function siteName(): string {
  return env("SITE_NAME") || "B-CORE FORM";
}

export function marketingSiteUrl(): string {
  return env("MARKETING_SITE_URL") || "https://b-core.space";
}
