import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Notion の台帳（講座DB・動画DB）を読み取り、Supabase のミラーに同期する。
 *
 * サイト本体は常に Supabase 側を読むため、Notion が落ちていたり
 * レート制限にかかっても表示は止まらない。
 * 同期は管理画面の「Notionから同期」ボタン、またはページ表示時の
 * 自動同期（10分以上古い場合にバックグラウンドで実行）で走る。
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

type NotionPage = {
  id: string;
  properties: Record<string, NotionProperty>;
};

type NotionProperty = {
  type: string;
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
  number?: number | null;
  checkbox?: boolean;
  relation?: Array<{ id: string }>;
  select?: { name: string } | null;
};

export function notionConfigured(): boolean {
  return Boolean(env("NOTION_TOKEN") && env("NOTION_COURSES_DB_ID") && env("NOTION_VIDEOS_DB_ID"));
}

async function queryDatabaseAll(databaseId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    // まず従来の「データベースID」で照会し、見つからなければ
    // 新しいAPIの「データソースID」として照会する（どちらのIDでも設定できるように）
    let res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("NOTION_TOKEN")}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    if (res.status === 404 || res.status === 400) {
      res = await fetch(`${NOTION_API}/data_sources/${databaseId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env("NOTION_TOKEN")}`,
          "Notion-Version": "2025-09-03",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
      });
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Notion API エラー (${res.status}): ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      results: NotionPage[];
      has_more: boolean;
      next_cursor: string | null;
    };
    pages.push(...json.results);
    cursor = json.has_more && json.next_cursor ? json.next_cursor : undefined;
  } while (cursor);
  return pages;
}

/* --- プロパティの読み出し（名前が多少違っても型で拾えるようにする） --- */

function findProp(page: NotionPage, names: string[], type: string): NotionProperty | null {
  for (const name of names) {
    const p = page.properties[name];
    if (p && p.type === type) return p;
  }
  for (const p of Object.values(page.properties)) {
    if (p.type === type) return p;
  }
  return null;
}

function textOf(prop: NotionProperty | null): string {
  if (!prop) return "";
  const parts = prop.type === "title" ? prop.title : prop.rich_text;
  return (parts ?? []).map((t) => t.plain_text).join("").trim();
}

function titleOf(page: NotionPage): string {
  return textOf(findProp(page, ["タイトル", "名前", "Name", "Title"], "title"));
}

function richTextOf(page: NotionPage, names: string[]): string {
  const p = names
    .map((n) => page.properties[n])
    .find((p) => p && p.type === "rich_text");
  return textOf(p ?? null);
}

function numberOf(page: NotionPage, names: string[]): number {
  for (const n of names) {
    const p = page.properties[n];
    if (p && p.type === "number" && typeof p.number === "number") return p.number;
  }
  return 0;
}

function checkboxOf(page: NotionPage, names: string[]): boolean {
  for (const n of names) {
    const p = page.properties[n];
    if (p && p.type === "checkbox") return Boolean(p.checkbox);
  }
  return false;
}

function relationOf(page: NotionPage, names: string[]): string | null {
  for (const n of names) {
    const p = page.properties[n];
    if (p && p.type === "relation") return p.relation?.[0]?.id ?? null;
  }
  for (const p of Object.values(page.properties)) {
    if (p.type === "relation") return p.relation?.[0]?.id ?? null;
  }
  return null;
}

/* --- 同期本体 --- */

export type SyncResult = {
  courses: number;
  videos: number;
  syncedAt: string;
};

export async function syncFromNotion(): Promise<SyncResult> {
  if (!notionConfigured()) {
    throw new Error("NOTION_TOKEN / NOTION_COURSES_DB_ID / NOTION_VIDEOS_DB_ID が未設定です");
  }
  const admin = createSupabaseAdminClient();

  const [coursePages, videoPages] = await Promise.all([
    queryDatabaseAll(env("NOTION_COURSES_DB_ID")),
    queryDatabaseAll(env("NOTION_VIDEOS_DB_ID")),
  ]);

  const courses = coursePages.map((page) => ({
    id: page.id,
    title: titleOf(page) || "(無題の講座)",
    description: richTextOf(page, ["説明", "Description"]),
    sort_order: numberOf(page, ["表示順", "Order"]),
    published: checkboxOf(page, ["公開", "Published"]),
    updated_at: new Date().toISOString(),
  }));

  const courseIds = new Set(courses.map((c) => c.id));

  const videos = videoPages.map((page) => {
    const courseId = relationOf(page, ["講座", "Course"]);
    return {
      id: page.id,
      course_id: courseId && courseIds.has(courseId) ? courseId : null,
      title: titleOf(page) || "(無題の動画)",
      description: richTextOf(page, ["説明", "Description"]),
      stream_uid: richTextOf(page, ["動画ID", "Stream UID", "StreamUID"]),
      sort_order: numberOf(page, ["表示順", "Order"]),
      published: checkboxOf(page, ["公開", "Published"]),
      free_preview: checkboxOf(page, ["無料サンプル", "無料公開", "Free"]),
      updated_at: new Date().toISOString(),
    };
  });

  // 先に講座を入れてから動画（外部キーの都合）
  if (courses.length > 0) {
    const { error } = await admin.from("courses").upsert(courses);
    if (error) throw new Error(`coursesの保存に失敗: ${error.message}`);
  }
  if (videos.length > 0) {
    const { error } = await admin.from("videos").upsert(videos);
    if (error) throw new Error(`videosの保存に失敗: ${error.message}`);
  }

  // Notion側で削除された行はミラーからも消す
  const videoIds = videos.map((v) => v.id);
  await admin
    .from("videos")
    .delete()
    .not("id", "in", `(${videoIds.map((id) => `"${id}"`).join(",") || '""'})`);
  await admin
    .from("courses")
    .delete()
    .not("id", "in", `(${[...courseIds].map((id) => `"${id}"`).join(",") || '""'})`);

  const syncedAt = new Date().toISOString();
  await admin.from("sync_state").upsert({ id: 1, last_synced_at: syncedAt });

  return { courses: courses.length, videos: videos.length, syncedAt };
}

/** 前回の同期が古ければバックグラウンドで同期を走らせる */
export async function maybeAutoSync(maxAgeMinutes = 10): Promise<void> {
  if (!notionConfigured()) return;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("sync_state")
      .select("last_synced_at")
      .eq("id", 1)
      .maybeSingle();
    const last = data?.last_synced_at ? new Date(data.last_synced_at).getTime() : 0;
    if (Date.now() - last < maxAgeMinutes * 60 * 1000) return;
    await syncFromNotion();
  } catch (err) {
    console.error("Notion自動同期に失敗:", err);
  }
}
