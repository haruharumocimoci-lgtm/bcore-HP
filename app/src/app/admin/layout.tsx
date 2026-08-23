import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";

export const metadata = { title: "管理画面" };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login?next=/admin");
  if (!(await isAdminUser(user))) redirect("/");

  return (
    <div className="container">
      <div className="page-title">
        <h1>管理画面</h1>
        <p>
          <Link href="/admin">ダッシュボード</Link>
          {" ／ "}
          <Link href="/admin/videos">動画</Link>
          {" ／ "}
          <Link href="/admin/members">会員</Link>
        </p>
      </div>
      {children}
    </div>
  );
}
