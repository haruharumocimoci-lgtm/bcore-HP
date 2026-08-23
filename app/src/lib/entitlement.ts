import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { membersDb } from "@/lib/env";

/** 視聴権限の判定結果 */
export type Entitlement = {
  entitled: boolean;
  status: string | null;
  plan: string | null;
  /** 現在の請求期間の終わり（ISO文字列） */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** どのデータベースで判定したか */
  source: "supabase" | "d1" | null;
};

const ACTIVE_STATUSES = ["active", "trialing"];

/**
 * メールアドレスから「いま有効なサブスク会員か」を判定する。
 *
 * 1. Supabase の subscriptions（このサイトのWebhookが更新）を見る
 * 2. 無ければ既存の D1 会員データベース（bcore-members）を見る
 *
 * 解約予約をしても期間末日までは Stripe 側の status が active のままなので、
 * 「お支払い済みの期間の末日まで利用できる」ルールと自動で一致する。
 */
export async function checkEntitlement(email: string | null | undefined): Promise<Entitlement> {
  const none: Entitlement = {
    entitled: false,
    status: null,
    plan: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    source: null,
  };
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return none;

  // 1) Supabase
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("subscriptions")
      .select("status, plan, current_period_end, cancel_at_period_end, is_test")
      .eq("email", normalized)
      .eq("is_test", false)
      .in("status", ACTIVE_STATUSES)
      .order("current_period_end", { ascending: false, nullsFirst: false })
      .limit(1);
    const row = data?.[0];
    if (row) {
      return {
        entitled: true,
        status: row.status,
        plan: row.plan,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
        source: "supabase",
      };
    }
  } catch (err) {
    console.error("Supabaseでの会員判定に失敗:", err);
  }

  // 2) D1（既存の会員基盤）
  try {
    const db = membersDb();
    if (db) {
      const row = await db
        .prepare(
          `SELECT status, plan, current_period_end, cancel_at_period_end
             FROM subscriptions
            WHERE email = ? AND status IN ('active','trialing') AND is_test = 0
            ORDER BY current_period_end DESC LIMIT 1`
        )
        .bind(normalized)
        .first<{
          status: string;
          plan: string | null;
          current_period_end: number | null;
          cancel_at_period_end: number | null;
        }>();
      if (row) {
        return {
          entitled: true,
          status: row.status,
          plan: row.plan,
          currentPeriodEnd: row.current_period_end
            ? new Date(row.current_period_end * 1000).toISOString()
            : null,
          cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
          source: "d1",
        };
      }
    }
  } catch (err) {
    console.error("D1での会員判定に失敗:", err);
  }

  return none;
}
