-- ============================================================
-- B-CORE FORM 初期スキーマ
-- Supabase の SQL Editor に貼り付けて実行するか、
-- supabase db push / MCP の apply_migration で適用する。
-- ============================================================

-- ---------- プロフィール（auth.users と1対1） ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 新規ユーザー登録時に自動でプロフィール行を作る
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Stripe 顧客（customer_id とメールの対応表） ----------
create table if not exists public.stripe_customers (
  id text primary key,               -- cus_xxx
  email text,
  name text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- サブスク契約（視聴権限の源泉） ----------
create table if not exists public.subscriptions (
  id text primary key,               -- sub_xxx
  customer_id text,
  email text,
  plan text,                         -- online / offline など
  price_id text,
  status text not null,              -- active / trialing / canceled / past_due …
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_email_idx on public.subscriptions (email);
create index if not exists subscriptions_customer_idx on public.subscriptions (customer_id);

-- ---------- Webhook 二重処理防止 ----------
create table if not exists public.webhook_events (
  id text primary key,               -- evt_xxx
  type text,
  is_test boolean not null default false,
  received_at timestamptz not null default now()
);

-- ---------- 講座・動画（Notion台帳のミラー） ----------
create table if not exists public.courses (
  id text primary key,               -- NotionページID
  title text not null,
  description text,
  sort_order double precision not null default 0,
  published boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.videos (
  id text primary key,               -- NotionページID
  course_id text references public.courses(id) on delete set null,
  title text not null,
  description text,
  stream_uid text,                   -- Cloudflare Stream の動画UID
  sort_order double precision not null default 0,
  published boolean not null default false,
  free_preview boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists videos_course_idx on public.videos (course_id);

-- ---------- 同期状態 ----------
create table if not exists public.sync_state (
  id int primary key,
  last_synced_at timestamptz
);

-- ============================================================
-- 行レベルセキュリティ（RLS）
-- サーバー（Service Roleキー）はRLSの影響を受けない。
-- anonキー経由のアクセスを最小限に絞る。
-- ============================================================

alter table public.profiles enable row level security;
alter table public.stripe_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.webhook_events enable row level security;
alter table public.courses enable row level security;
alter table public.videos enable row level security;
alter table public.sync_state enable row level security;

-- 本人は自分のプロフィールを読める（roleの書き換えは不可）
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- 本人は自分の契約状態を読める（メールアドレス一致）
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select using (lower(coalesce(auth.jwt() ->> 'email', '')) = lower(coalesce(email, '')));

-- 公開中の講座・動画は誰でも読める（一覧表示用。再生自体はトークンで保護）
drop policy if exists "courses_select_published" on public.courses;
create policy "courses_select_published" on public.courses
  for select using (published = true);

drop policy if exists "videos_select_published" on public.videos;
create policy "videos_select_published" on public.videos
  for select using (published = true);

-- stripe_customers / webhook_events / sync_state は anon からは一切読めない
-- （ポリシーを作らない = すべて拒否）
