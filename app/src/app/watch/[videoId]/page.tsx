import Link from "next/link";
import { notFound } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { checkEntitlement } from "@/lib/entitlement";
import { getVideo, getCourse, getPublishedVideosByCourse } from "@/lib/content";
import { Paywall } from "@/components/Paywall";
import { VideoPlayer } from "@/components/VideoPlayer";

export const dynamic = "force-dynamic";

export default async function WatchPage({
  params,
}: {
  params: Promise<{ videoId: string }>;
}) {
  const { videoId } = await params;
  const video = await getVideo(videoId);
  if (!video || !video.published) notFound();

  // middleware でログイン必須にしているが、念のためここでも確認する
  const user = await getUser();
  const entitlement = user ? await checkEntitlement(user.email) : null;
  const canWatch = Boolean(entitlement?.entitled) || video.free_preview;

  const course = video.course_id ? await getCourse(video.course_id) : null;
  const siblings = video.course_id
    ? await getPublishedVideosByCourse(video.course_id)
    : [];

  return (
    <div className="container">
      <p className="breadcrumb">
        <Link href="/">講座一覧</Link>
        {course && (
          <>
            {" ／ "}
            <Link href={`/courses/${course.id}`}>{course.title}</Link>
          </>
        )}
        {" ／ "}
        {video.title}
      </p>

      <div className="page-title">
        <h1>{video.title}</h1>
        {video.description && <p>{video.description}</p>}
      </div>

      {canWatch ? (
        <VideoPlayer videoId={video.id} />
      ) : (
        <Paywall loggedIn={Boolean(user)} email={user?.email} />
      )}

      {siblings.length > 1 && (
        <section className="section">
          <h2>この講座のほかの動画</h2>
          {siblings
            .filter((v) => v.id !== video.id)
            .map((v) => (
              <Link key={v.id} href={`/watch/${v.id}`} className="video-row">
                <div className="title">{v.title}</div>
                <span className="badge">▶</span>
              </Link>
            ))}
        </section>
      )}
    </div>
  );
}
