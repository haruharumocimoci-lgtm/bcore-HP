# B-CORE 会員基盤（Cloudflare Workers + D1）

講義プラットフォームの土台です。**StripeのWebhook通知を受け取って、「誰がいま有効な会員か」をデータベースに記録し続けます。**
公式HP（`index.html`）とは別物で、こちらはサーバー側のプログラムです。

```
お客さんがStripeで申し込む／解約する
        ↓（Stripeが自動で通知）
  Webhook  https://bcore-hp.haruharumocimoci.workers.dev/stripe/webhook
        ↓
  D1データベース（bcore-members）
        ↓
  講義プラットフォームの入室チェック（← 次に作るもの）
```

## 記録される内容

| テーブル | 内容 |
| --- | --- |
| `customers` | メールアドレスと Stripe の顧客ID（`cus_xxx`）の対応表 |
| `subscriptions` | 契約ごとの状態（プラン・`active`/`canceled`・期間の終わり・解約予約の有無） |
| `webhook_events` | 受信済み通知のID。同じ通知が二重に処理されるのを防ぐ |
| `inventory` | スパサブなど都度購入の商品の残り個数（本番・テストモード別） |
| `orders` | スパサブの注文（個数・返金状況）。在庫を減らした記録 |

「入室してよい人」の判定はこの1行で行えます。

```sql
SELECT 1 FROM subscriptions
WHERE email = ? AND status IN ('active', 'trialing') AND is_test = 0;
```

（`is_test = 0` を忘れると、テストモードで作った会員も「有効」と判定されてしまいます）

解約しても、期間の末日まで Stripe 側の状態は `active` のままです。
末日を過ぎると Stripe が `customer.subscription.deleted` を送ってきて `canceled` に変わります。
つまり **HPに書いた「お支払い済みの期間の末日までご利用いただけます」というルールと、自動で一致します。**

## セットアップ

### 1. Cloudflareにログイン

```sh
cd platform
npm install
npx wrangler login      # ブラウザが開くので許可する
```

### 2. データベース

D1データベース `bcore-members` は作成済み・テーブル作成済みです（`wrangler.toml` にIDを記載）。
作り直す場合のみ:

```sh
npm run schema:remote
```

### 3. Workerを公開する

```sh
npm run deploy
```

公開URL: **https://bcore-hp.haruharumocimoci.workers.dev**

> Workerの名前は `bcore-hp` です（Cloudflare側がリポジトリ名から付けたもの）。`wrangler.toml` の `name` もこれに揃えてあります。食い違うとビルドが失敗します。
> 公開はCloudflareの「Workers &amp; Pages」から自動で行われるため、通常このコマンドを打つ必要はありません（GitHubにpushすると自動でビルドされます）。

### 4. Stripeにシークレットを登録する

**先にStripe側でWebhookを作成してください**（下の「Stripeの設定」参照）。発行された `whsec_...` を登録します。

```sh
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # whsec_xxxxx を貼る
npx wrangler secret put STRIPE_SECRET_KEY       # sk_live_xxxxx を貼る（任意・推奨）
```

- `STRIPE_WEBHOOK_SECRET` … 本番モード用。`whsec_` で始まる文字列
- `STRIPE_WEBHOOK_SECRET_TEST` … テストモード用。テストモードで登録したWebhookの `whsec_`
- **どちらか一方でもあれば動きます**（両方入れておけば、本番とテストの両方を同時に受け付けます）
- `STRIPE_SECRET_KEY` … 任意。通知の順番が前後してメールアドレスが分からないとき、Stripeに直接問い合わせるために使います

> ⚠️ この2つは**絶対に `wrangler.toml` やHTMLに書かないでください**。`wrangler secret put` で登録すると、Cloudflare側に暗号化して保存され、コードには残りません。

### 5. プランの対応付け（任意）

`wrangler.toml` の `[vars]` に price_id を書くと、契約がどちらのプランか記録されます。
Stripeダッシュボード →「商品カタログ」→ 商品 → 料金 の `price_xxxxx` をコピーしてください。

```toml
[vars]
PRICE_ONLINE  = "price_xxxxxxxx"
PRICE_OFFLINE = "price_yyyyyyyy"
```

書き換えたら `npm run deploy` で反映します。

## Stripeの設定

https://dashboard.stripe.com → 「開発者」→「Webhook」→「エンドポイントを追加」

| 項目 | 値 |
| --- | --- |
| エンドポイントURL | `https://bcore-hp.haruharumocimoci.workers.dev/stripe/webhook` |
| イベント | 下の6つ |

送信するイベント:

- `checkout.session.completed` — 申し込み完了（**メールアドレスはここで分かります**）／スパサブの購入（在庫を減らす）
- `customer.subscription.created` — 契約開始
- `customer.subscription.updated` — 解約予約・プラン変更・支払い失敗
- `customer.subscription.deleted` — 契約終了（期間末に届く）
- `customer.updated` — メールアドレスの変更
- `charge.refunded` — 返金（スパサブの在庫を戻す）

登録すると `whsec_...`（署名シークレット）が表示されます。これを手順4で登録してください。

## テストモードで試す

Stripeを**テストモード**に切り替えると、テストカード `4242 4242 4242 4242` を使い、
実際のお金を動かさずに申し込みから解約まで何度でも試せます。

1. Stripeダッシュボード右上の切り替えで「**テストモード**」にする
2. 「開発者」→「Webhook」→ **同じURL**でエンドポイントを作る（イベントも同じ6つ）
3. 発行された `whsec_...` を、Cloudflareの `STRIPE_WEBHOOK_SECRET_TEST` に登録する

本番用の `STRIPE_WEBHOOK_SECRET` はそのままで構いません。
Workerは署名が合った方の鍵を自動で判別します。

テストモードで届いたデータには `is_test = 1` が付くので、本番の会員と混ざりません。

```sh
# 本物の会員だけを見る
SELECT email, plan, status FROM subscriptions WHERE is_test = 0;
```

> テスト用のデータを消したいとき:
> `DELETE FROM subscriptions WHERE is_test = 1;` / `DELETE FROM customers WHERE is_test = 1;`

## 動作確認

```sh
curl https://bcore-hp.haruharumocimoci.workers.dev/health
# → {"ok":true}
```

Stripeダッシュボードの「Webhook」画面から**テストイベントを送信**すると、
「送信済みイベント」に成功（200）と表示されます。

実際のデータは次のコマンドで確認できます。

```sh
npx wrangler d1 execute bcore-members --remote --command "SELECT email, plan, status FROM subscriptions;"
```

## ローカルで開発する

```sh
cp .dev.vars.example .dev.vars   # ローカル用の変数（初回のみ。Git管理外）
npm run schema:local             # ローカル用DBにテーブルを作る（初回のみ）
npx wrangler dev                 # http://127.0.0.1:8787 で起動
npm test                         # 別のターミナルで実行
```

`npm test` は署名検証・二重受信・解約・通知の順序入れ替わり・在庫管理を確認します（32項目）。
在庫管理のテストは、テスト自身が立てる「偽のStripe API」を使うので、本物のStripeには繋ぎません
（`.dev.vars.example` の `STRIPE_API_BASE` がその設定です）。

## 在庫管理（スパサブ）

スパサブ（¥300・都度購入）は在庫 600 個からスタートします。
**在庫はStripeの決済完了で自動的に減り、0 になるとHPのSTOREページが「SOLD OUT」表示に切り替わります。** 手で数える必要はありません。

```
お客さんがStripeで購入
   ↓ Webhook（checkout.session.completed）
 inventory.stock を買った個数ぶん減らす（明細を Stripe API から取得）
   ↓ 0 になったら
 Stripe の支払いリンクを自動で無効化（HPを経由しない直接URLからの購入も止まる）

HPのSTOREページ → GET /stock → 「残り◯個」（50個以下）／「SOLD OUT」（0個）を表示
全額返金        → Webhook（charge.refunded）→ その注文の個数ぶん在庫を戻す
```

`GET /stock` の返事はこんな形です（HPが読むだけなので、誰でも見られて問題ない情報だけ返します）。

```json
{"ok":true,"test":false,"products":{"spasub":{"stock":598,"soldOut":false,"updatedAt":1756900000}}}
```

### 有効にする手順（初回のみ）

1. **テーブルを作る**: `npm run schema:remote`
   `inventory` と `orders` が作られ、スパサブ 600 個（本番用・テスト用）が入ります。既存の会員データには触りません。
2. **スパサブのIDを `wrangler.toml` の `[vars]` に書く**
   - `PRICE_SPASUB` … Stripe →「商品カタログ」→ スパサブ → 料金 の `price_xxx`
   - `PAYMENT_LINK_SPASUB` … Stripe →「支払いリンク」→ スパサブのリンクを開く → 詳細に表示される `plink_xxx`（`buy.stripe.com/...` のURLではありません）
   - テストモードの支払いリンクも自動で無効化したい場合は `PAYMENT_LINK_SPASUB_TEST` に `plink_xxx`（任意）
3. **`STRIPE_SECRET_KEY` を登録する**（未登録なら）: `npx wrangler secret put STRIPE_SECRET_KEY`
   決済の明細（何個買われたか）を Stripe に問い合わせるのに使います。無い場合は「1決済 = 1個」として数えます。
   テストモードも試すなら `STRIPE_SECRET_KEY_TEST` に `sk_test_xxx` も。
4. **StripeのWebhookに `charge.refunded` を追加する**（本番・テストの両方のエンドポイント）
5. push（自動ビルド）または `npm run deploy`。`/health` で `prices.spasub` と `stock.paymentLink` が `true`、`stock.apiKey.live` が `true` になっていれば完了です。

> 設定が空のままでも壊れはしません。在庫が減らず、HPには従来どおり購入ボタンが出続けるだけです。

### 在庫を見る・補充する

```sh
npm run stock      # 残り個数を見る（is_test=0 が本番、1 がテストモード）
```

```sh
# 100 個入荷したとき
npx wrangler d1 execute bcore-members --remote --command "UPDATE inventory SET stock = stock + 100, updated_at = strftime('%s','now') WHERE product = 'spasub' AND is_test = 0;"

# 数え直して 600 に戻すとき
npx wrangler d1 execute bcore-members --remote --command "UPDATE inventory SET stock = 600, updated_at = strftime('%s','now') WHERE product = 'spasub' AND is_test = 0;"

# 注文の一覧（新しい順に20件）
npx wrangler d1 execute bcore-members --remote --command "SELECT id, quantity, email, status, datetime(created_at,'unixepoch','+9 hours') AS jst FROM orders WHERE is_test = 0 ORDER BY created_at DESC LIMIT 20;"
```

> ⚠️ 売り切れで無効化された支払いリンクは、自動では元に戻りません。
> 入荷して在庫を足したら、Stripe →「支払いリンク」→ スパサブ →「有効にする」で戻してください。
> HPの表示は在庫を足した時点で自動的に購入ボタンへ戻ります。

### Stripe側でも上限をかける（おすすめ）

Workerが止まっている間の売り越しを防ぐ二重の安全策として、Stripeの支払いリンクの設定（「詳細オプション」）で
**「支払い回数を制限する」を 600** にしておくのがおすすめです。上限に達するとStripe側でも購入できなくなります。

### 知っておくこと

- **一部返金**では在庫は戻りません（全額返金のみ）。戻したい場合は上の `UPDATE` 文で手で足してください
- 明細を取得できなかった決済は **1個として数え**、Workerのログに警告が出ます。まとめ買いだった場合は手で直してください
- **テストモード**の購入はテスト用の在庫（`is_test = 1`）を減らします。HPを `?test=1` で開くとそちらの在庫が表示されるので、
  `UPDATE inventory SET stock = 1 WHERE product = 'spasub' AND is_test = 1;` にしてからテストカードで1つ買うと、SOLD OUT 表示を実際に確認できます
- Workerが落ちた等で **HP側だけ緊急に SOLD OUT** にしたいときは、`index.html` の `STORE_FORCE_SOLD_OUT.spasub` を `true` にして push
- 商品を増やすときは `src/index.js` の `STOCK_PRODUCTS`、`wrangler.toml` の `[vars]`、`schema.sql` の初期在庫、`index.html` の `data-product` の4か所に追加します

## セキュリティ上の要点

- **署名検証**: Stripe以外から送られた偽の通知は受け付けません（HMAC-SHA256で照合）
- **リプレイ対策**: 5分以上前のタイムスタンプの通知は拒否します
- **二重処理の防止**: 同じイベントIDは1回しか処理しません
- **失敗時の再送**: 処理に失敗した場合は500を返し、Stripeが自動で再送します
