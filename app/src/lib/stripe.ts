import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Stripe Webhook の処理。
 *
 * 決済フォームはこのサイトには置かず、既存HP（b-core.space）の
 * Stripe支払いリンクで契約してもらう。Stripeからの通知（Webhook）を
 * ここで受け取り、Supabase の subscriptions を更新して視聴権限を切り替える。
 *
 * 会員との紐付けはメールアドレス。ユーザーが決済時に入力したメールと
 * このサイトの会員登録メールが一致すれば視聴できるようになる。
 */

const encoder = new TextEncoder();

export type StripeEvent = {
  id: string;
  type: string;
  livemode?: boolean;
  data?: { object?: Record<string, unknown> };
};

/* ---------- 署名検証（Stripe-Signature: t=…,v1=…） ---------- */

export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSec = 300
): Promise<boolean> {
  if (!header) return false;

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  // 古い通知の使い回し（リプレイ攻撃）を防ぐ
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSec() - ts) > toleranceSec) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`));
  const expected = toHex(new Uint8Array(mac));

  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/* ---------- イベント処理 ---------- */

type Ctx = { isTest: boolean };

export async function handleStripeEvent(event: StripeEvent, ctx: Ctx): Promise<void> {
  const object = (event.data?.object ?? {}) as Record<string, unknown>;

  switch (event.type) {
    // 決済完了。ここで初めてメールアドレスが分かる
    case "checkout.session.completed": {
      const customerId = asId(object.customer);
      const details = object.customer_details as { email?: string; name?: string } | undefined;
      const email = normalizeEmail(details?.email || (object.customer_email as string));
      if (customerId) {
        await upsertCustomer(customerId, email, details?.name ?? null, ctx);
        if (email) await backfillEmail(customerId, email);
      }
      return;
    }

    case "customer.created":
    case "customer.updated": {
      const id = object.id as string | undefined;
      if (id) {
        const email = normalizeEmail(object.email as string);
        await upsertCustomer(id, email, (object.name as string) ?? null, ctx);
        if (email) await backfillEmail(id, email);
      }
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await upsertSubscription(event, ctx);
      return;
    }

    default:
      // 未対応のイベントは無視（Stripeには200を返す）
      return;
  }
}

async function upsertCustomer(
  customerId: string,
  email: string | null,
  name: string | null,
  ctx: Ctx
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("stripe_customers")
    .select("email, name")
    .eq("id", customerId)
    .maybeSingle();

  const { error } = await admin.from("stripe_customers").upsert({
    id: customerId,
    email: email ?? existing?.email ?? null,
    name: name ?? existing?.name ?? null,
    is_test: ctx.isTest,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`stripe_customersの保存に失敗: ${error.message}`);
}

// 顧客のメールアドレスが後から判明したとき、契約テーブル側にも反映する
async function backfillEmail(customerId: string, email: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("subscriptions")
    .update({ email, updated_at: new Date().toISOString() })
    .eq("customer_id", customerId)
    .neq("email", email);
  if (error) throw new Error(`メールの反映に失敗: ${error.message}`);
}

async function upsertSubscription(event: StripeEvent, ctx: Ctx): Promise<void> {
  const sub = (event.data?.object ?? {}) as {
    id?: string;
    customer?: unknown;
    status?: string;
    cancel_at_period_end?: boolean;
    current_period_end?: number;
    items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> };
  };
  const customerId = asId(sub.customer);
  if (!sub.id || !customerId) throw new Error("subscription に id / customer がありません");

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? null;

  // Stripeの新しいAPIバージョンでは請求期間が items 側に移動している
  const periodEnd = sub.current_period_end ?? item?.current_period_end ?? null;

  // 解約イベントのときは status が active のまま届くことがあるため上書きする
  const status = event.type === "customer.subscription.deleted" ? "canceled" : sub.status;

  const email = await resolveEmail(customerId, ctx);
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("subscriptions")
    .select("email, plan, price_id, current_period_end")
    .eq("id", sub.id)
    .maybeSingle();

  const { error } = await admin.from("subscriptions").upsert({
    id: sub.id,
    customer_id: customerId,
    email: email ?? existing?.email ?? null,
    plan: planFromPrice(priceId) ?? existing?.plan ?? null,
    price_id: priceId ?? existing?.price_id ?? null,
    status: status ?? "unknown",
    current_period_end: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : existing?.current_period_end ?? null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    is_test: ctx.isTest,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`subscriptionsの保存に失敗: ${error.message}`);
}

// 支払いリンクのprice_idからプラン名を決める（環境変数で対応付け）
function planFromPrice(priceId: string | null): string | null {
  if (!priceId) return null;
  if (env("PRICE_ONLINE") && priceId === env("PRICE_ONLINE")) return "online";
  if (env("PRICE_OFFLINE") && priceId === env("PRICE_OFFLINE")) return "offline";
  return null;
}

// customer_id からメールアドレスを引く。DBになければStripeに問い合わせる
async function resolveEmail(customerId: string, ctx: Ctx): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("stripe_customers")
    .select("email")
    .eq("id", customerId)
    .maybeSingle();
  if (data?.email) return data.email;

  // テストモードのイベントにはテスト用のキーを使う（本番キーでは引けない）
  const apiKey = env(ctx.isTest ? "STRIPE_SECRET_KEY_TEST" : "STRIPE_SECRET_KEY");
  if (!apiKey) return null;

  const res = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error(`Stripeから顧客を取得できませんでした ${customerId}: ${res.status}`);
    return null;
  }
  const customer = (await res.json()) as { email?: string; name?: string };
  const email = normalizeEmail(customer.email);
  if (email) await upsertCustomer(customerId, email, customer.name ?? null, ctx);
  return email;
}

function asId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

function normalizeEmail(email: unknown): string | null {
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}
