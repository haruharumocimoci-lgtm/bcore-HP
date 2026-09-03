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

-- =========================================================
-- 在庫管理（スパサブなど、都度購入の商品）
-- =========================================================

-- 商品ごとの残り個数。本番とテストモードは別々に数える（is_test）
CREATE TABLE IF NOT EXISTS inventory (
  product     TEXT NOT NULL,               -- 'spasub'
  is_test     INTEGER NOT NULL DEFAULT 0,  -- 1ならテストモードの在庫
  stock       INTEGER NOT NULL,            -- 残り個数
  updated_at  INTEGER NOT NULL,            -- UNIX秒
  PRIMARY KEY (product, is_test)
);

-- 初期在庫（既に行があれば何もしないので、schema.sql は何度流しても安全）
INSERT OR IGNORE INTO inventory (product, is_test, stock, updated_at) VALUES
  ('spasub', 0, 600, strftime('%s', 'now')),
  ('spasub', 1, 600, strftime('%s', 'now'));

-- 都度購入の注文。在庫を減らした記録で、返金のときに戻す個数を知るために使う
CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,   -- 決済セッションID + ':' + 商品（例 cs_xxx:spasub）
  product         TEXT NOT NULL,
  quantity        INTEGER NOT NULL,
  email           TEXT,
  payment_intent  TEXT,               -- pi_xxx（返金の通知と突き合わせる）
  status          TEXT NOT NULL,      -- paid / refunded
  is_test         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_payment_intent ON orders(payment_intent);
