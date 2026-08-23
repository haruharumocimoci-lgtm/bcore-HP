import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  verifyStripeSignature,
  handleStripeEvent,
  type StripeEvent,
} from "@/lib/stripe";

/**
 * Stripe Webhook 受信エンドポイント。
 * StripeダッシュボードにこのURLを登録する:
 *   https://bcoreform.com/api/stripe/webhook
 *
 * 受け取るイベント:
 *   checkout.session.completed / customer.created / customer.updated
 *   customer.subscription.created / updated / deleted
 */
export async function POST(request: NextRequest) {
  const secrets = [
    { mode: "live", value: env("STRIPE_WEBHOOK_SECRET") },
    { mode: "test", value: env("STRIPE_WEBHOOK_SECRET_TEST") },
  ].filter((s) => s.value);

  if (secrets.length === 0) {
    console.error("STRIPE_WEBHOOK_SECRET が未設定です");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  // 署名検証には「加工前の生データ」が必要なので、必ず text() で読む
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") || "";

  let matched = null;
  for (const secret of secrets) {
    if (await verifyStripeSignature(payload, signature, secret.value)) {
      matched = secret;
      break;
    }
  }
  if (!matched) {
    // 署名が合わない = Stripe以外からの偽の通知。処理せず拒否する
    console.error("Stripe署名が一致しません");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }

  const isTest = event.livemode === false;
  const admin = createSupabaseAdminClient();

  // 同じイベントが再送されても二重処理しない
  const { error: insertError } = await admin.from("webhook_events").insert({
    id: event.id,
    type: event.type,
    is_test: isTest,
  });
  if (insertError) {
    if (insertError.code === "23505") {
      // すでに処理済み
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error("webhook_eventsの記録に失敗:", insertError.message);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }

  try {
    await handleStripeEvent(event, { isTest });
  } catch (err) {
    // 失敗したイベントは記録を消し、Stripeに再送させる
    await admin.from("webhook_events").delete().eq("id", event.id);
    console.error(`イベント処理に失敗 ${event.type} (${event.id}):`, err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
