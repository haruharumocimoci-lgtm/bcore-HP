import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** 講座（Supabaseミラー上の1行） */
export type Course = {
  id: string;
  title: string;
  description: string | null;
  sort_order: number;
  published: boolean;
};

/** 動画（Supabaseミラー上の1行） */
export type Video = {
  id: string;
  course_id: string | null;
  title: string;
  description: string | null;
  stream_uid: string | null;
  sort_order: number;
  published: boolean;
  free_preview: boolean;
};

export async function getPublishedCourses(): Promise<Course[]> {
  try {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("courses")
    .select("id, title, description, sort_order, published")
    .eq("published", true)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });
  return (data as Course[]) ?? [];
  } catch (err) {
    console.error("coursesの取得に失敗:", err);
    return [];
  }
}

export async function getCourse(id: string): Promise<Course | null> {
  try {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("courses")
    .select("id, title, description, sort_order, published")
    .eq("id", id)
    .maybeSingle();
  return (data as Course) ?? null;
  } catch (err) {
    console.error("courseの取得に失敗:", err);
    return null;
  }
}

export async function getPublishedVideosByCourse(courseId: string): Promise<Video[]> {
  try {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("videos")
    .select("id, course_id, title, description, stream_uid, sort_order, published, free_preview")
    .eq("course_id", courseId)
    .eq("published", true)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });
  return (data as Video[]) ?? [];
  } catch (err) {
    console.error("videosの取得に失敗:", err);
    return [];
  }
}

export async function getVideo(id: string): Promise<Video | null> {
  try {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("videos")
    .select("id, course_id, title, description, stream_uid, sort_order, published, free_preview")
    .eq("id", id)
    .maybeSingle();
  return (data as Video) ?? null;
  } catch (err) {
    console.error("videoの取得に失敗:", err);
    return null;
  }
}

/** 公開中の動画本数を講座ごとに数える（一覧のバッジ表示用） */
export async function countVideosByCourse(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("videos")
    .select("course_id")
    .eq("published", true);
  for (const row of (data as { course_id: string | null }[]) ?? []) {
    if (!row.course_id) continue;
    map.set(row.course_id, (map.get(row.course_id) ?? 0) + 1);
  }
  } catch (err) {
    console.error("動画本数の集計に失敗:", err);
  }
  return map;
}
