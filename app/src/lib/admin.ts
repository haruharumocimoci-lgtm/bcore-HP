import type { User } from "@supabase/supabase-js";
import { adminEmails } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 管理者かどうかの判定。
 * - 環境変数 ADMIN_EMAILS に載っているメールアドレス
 * - または Supabase の profiles.role が 'admin'
 */
export async function isAdminUser(user: User | null): Promise<boolean> {
  if (!user) return false;
  const email = user.email?.trim().toLowerCase();
  if (email && adminEmails().includes(email)) return true;

  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    return data?.role === "admin";
  } catch {
    return false;
  }
}
