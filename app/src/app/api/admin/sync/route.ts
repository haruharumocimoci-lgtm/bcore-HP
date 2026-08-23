import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { syncFromNotion } from "@/lib/notion";

/** 管理画面の「Notionから同期」ボタン */
export async function POST() {
  const user = await getUser();
  if (!user || !(await isAdminUser(user))) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
  try {
    const result = await syncFromNotion();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "同期に失敗しました" },
      { status: 500 }
    );
  }
}
