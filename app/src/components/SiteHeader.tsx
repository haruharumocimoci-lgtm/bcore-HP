import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";

export async function SiteHeader() {
  const user = await getUser();
  const admin = user ? await isAdminUser(user) : false;

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link href="/" className="brand">
          B-CORE <span>FORM</span>
        </Link>
        <nav className="nav">
          <Link href="/">講座一覧</Link>
          {user ? (
            <>
              {admin && <Link href="/admin">管理</Link>}
              <Link href="/account">マイページ</Link>
              <form action="/auth/signout" method="post" style={{ display: "inline" }}>
                <button className="btn btn--ghost btn--sm" type="submit">
                  ログアウト
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login">ログイン</Link>
              <Link href="/signup" className="btn btn--sm">
                会員登録
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
