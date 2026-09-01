import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 会員登録（サーバー側）。
 *
 * ブラウザから supabase.auth.signUp を呼ぶ代わりに、ここで
 * 管理APIを使って「メール確認済み」の状態でアカウントを作る。
 *
 * 理由: 確認メール方式にすると、メールが届かないだけで登録が完了せず、
 * お客さんは「登録できない」と感じて離脱してしまう。
 * Supabaseの標準メール送信は1時間あたりの送信数が少なく、実際に詰まった。
 *
 * 動画の視聴可否はStripeの決済状況だけで判定しているため、
 * メール確認の有無はセキュリティに影響しない（未契約者は何も見られない）。
 */
export async function POST(request: NextRequest) {
  let email = "";
  let password = "";
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    email = (body.email ?? "").trim().toLowerCase();
    password = body.password ?? "";
  } catch {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "パスワードは8文字以上にしてください" }, { status: 400 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json(
      { error: "サーバーの設定が未完了です。管理者にお問い合わせください。" },
      { status: 503 }
    );
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // 確認メールを待たずに使えるようにする
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("already") || message.includes("registered") || message.includes("exists")) {
      return NextResponse.json(
        { error: "このメールアドレスは登録済みです。ログインしてください。", code: "already_registered" },
        { status: 409 }
      );
    }
    console.error("会員登録に失敗:", error.message);
    return NextResponse.json({ error: "登録に失敗しました。時間をおいてお試しください。" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
