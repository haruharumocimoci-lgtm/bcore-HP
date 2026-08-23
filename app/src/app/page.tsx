import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { checkEntitlement } from "@/lib/entitlement";
import { getPublishedCourses, countVideosByCourse } from "@/lib/content";
import { maybeAutoSync } from "@/lib/notion";
import { marketingSiteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Notionの台帳が更新されていたらバックグラウンドで取り込む
  await maybeAutoSync();

  const user = await getUser();
  const entitlement = user ? await checkEntitlement(user.email) : null;
  const [courses, counts] = await Promise.all([
    getPublishedCourses(),
    countVideosByCourse(),
  ]);

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>
            B-COREの技術を、
            <br />
            いつでも・何度でも。
          </h1>
          <p>
            野球塾 B-CORE のサブスク会員限定 動画レッスン。打撃・投球・トレーニングの講座を、
            スマホでもPCでも好きな時間に視聴できます。
          </p>
          <div className="actions">
            {!user && (
              <>
                <Link href="/signup" className="btn">
                  無料で会員登録
                </Link>
                <Link href="/login" className="btn btn--ghost">
                  ログイン
                </Link>
              </>
            )}
            {user && !entitlement?.entitled && (
              <a href={`${marketingSiteUrl()}/#price`} className="btn" target="_blank" rel="noopener">
                プランに申し込む（公式HPへ）
              </a>
            )}
            {entitlement?.entitled && (
              <span className="badge badge--ok">サブスク会員（視聴できます）</span>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>講座一覧</h2>
          {courses.length === 0 ? (
            <p style={{ color: "var(--text-dim)" }}>
              講座は準備中です。公開までしばらくお待ちください。
            </p>
          ) : (
            <div className="grid">
              {courses.map((course) => (
                <Link key={course.id} href={`/courses/${course.id}`} className="card">
                  <h3>{course.title}</h3>
                  {course.description && <p>{course.description}</p>}
                  <span className="badge">
                    動画 {counts.get(course.id) ?? 0} 本
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
