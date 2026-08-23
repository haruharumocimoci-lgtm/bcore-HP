import Link from "next/link";
import { notFound } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { checkEntitlement } from "@/lib/entitlement";
import { getCourse, getPublishedVideosByCourse } from "@/lib/content";
import { Paywall } from "@/components/Paywall";

export const dynamic = "force-dynamic";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const course = await getCourse(courseId);
  if (!course || !course.published) notFound();

  const [videos, user] = await Promise.all([
    getPublishedVideosByCourse(courseId),
    getUser(),
  ]);
  const entitlement = user ? await checkEntitlement(user.email) : null;
  const canWatch = Boolean(entitlement?.entitled);

  return (
    <div className="container">
      <p className="breadcrumb">
        <Link href="/">講座一覧</Link> ／ {course.title}
      </p>
      <div className="page-title">
        <h1>{course.title}</h1>
        {course.description && <p>{course.description}</p>}
      </div>

      <section className="section">
        {videos.length === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>この講座の動画は準備中です。</p>
        ) : (
          videos.map((video, index) => {
            const locked = !canWatch && !video.free_preview;
            return (
              <Link key={video.id} href={`/watch/${video.id}`} className="video-row">
                <div>
                  <div className="title">
                    {index + 1}. {video.title}
                  </div>
                  {video.description && <div className="desc">{video.description}</div>}
                </div>
                <div>
                  {video.free_preview ? (
                    <span className="badge badge--accent">無料サンプル</span>
                  ) : locked ? (
                    <span className="badge">🔒 会員限定</span>
                  ) : (
                    <span className="badge badge--ok">視聴する ▶</span>
                  )}
                </div>
              </Link>
            );
          })
        )}

        {!canWatch && <Paywall loggedIn={Boolean(user)} email={user?.email} />}
      </section>
    </div>
  );
}
