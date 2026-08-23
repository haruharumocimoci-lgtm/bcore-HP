import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * サーバーコンポーネント / Route Handler 用の Supabase クライアント。
 * ログイン中ユーザーのセッション（Cookie）を引き継ぐ。
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  if (!env("NEXT_PUBLIC_SUPABASE_URL") || !env("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    return null;
  }

  return createServerClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // サーバーコンポーネントからは Cookie を書けない。
            // セッション更新は middleware 側で行われるので無視してよい。
          }
        },
      },
    }
  );
}

/** ログイン中のユーザーを取得（未ログイン・未設定なら null） */
export async function getUser() {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return null;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch (err) {
    console.error("ユーザー取得に失敗:", err);
    return null;
  }
}
