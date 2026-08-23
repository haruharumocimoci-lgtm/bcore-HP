import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service Role キーを使う管理用クライアント（サーバー専用）。
 * RLS（行レベルセキュリティ）を越えて読み書きできるため、
 * Webhook処理・Notion同期・管理画面のサーバー処理だけで使う。
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL が設定されていません"
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
