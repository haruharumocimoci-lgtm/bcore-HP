import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { createDirectUpload } from "@/lib/stream";

/**
 * 管理画面用: Cloudflare Stream への直接アップロードURLを発行する。
 * 発行される動画は必ず「署名付きURL必須」になる。
 */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user || !(await isAdminUser(user))) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
  let name = "";
  try {
    const body = (await request.json()) as { name?: string };
    name = body.name?.trim() || "";
  } catch {
    // 名前なしでも発行できる
  }
  try {
    const result = await createDirectUpload({ name });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "発行に失敗しました" },
      { status: 500 }
    );
  }
}
