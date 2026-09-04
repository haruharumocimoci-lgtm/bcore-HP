-- B-CORE 会員基盤 データベース定義（Cloudflare D1）
--
-- Stripeで決済したお客さんの情報を、Webhook経由でここに溜めていきます。
-- 「このメールアドレスの人は、いま有効な会員か？」を判定するのが目的です。

-- Stripeの顧客（メールアドレスと customer_id の対応表）
CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,   -- cus_xxxxxxxx
  email       TEXT,               -- 必ず小文字で保存する
  name        TEXT,
  is_test     INTEGER NOT NULL DEFAULT 0,  -- 1ならテストモードのデータ
  created_at  INTEGER NOT NULL,   -- UNIX秒
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

-- サブスクリプション（ONLINE / OFFLINE の契約状況）
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   TEXT PRIMARY KEY,  -- sub_xxxxxxxx
  customer_id          TEXT NOT NULL,
  email                TEXT,
  plan                 TEXT,              -- 'online' / 'offline' / NULL（未判定）
  price_id             TEXT,
  status               TEXT NOT NULL,     -- active / trialing / past_due / canceled など
  current_period_end   INTEGER,           -- 今の請求期間の終わり（UNIX秒）
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,  -- 1 なら期間末で解約予定
  is_test              INTEGER NOT NULL DEFAULT 0,  -- 1ならテストモードのデータ
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- 受信済みWebhookイベント（同じ通知を二重に処理しないため）
CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,  -- evt_xxxxxxxx
  type         TEXT NOT NULL,
  is_test      INTEGER NOT NULL DEFAULT 0,
  received_at  INTEGER NOT NULL
);

-- 既存のデータベースに後から列を足す場合（エラーが出たら既に追加済み）
-- ALTER TABLE customers     ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE subscriptions ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE webhook_events ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
