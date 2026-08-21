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

「入室してよい人」の判定はこの1行で行えます。

```sql
SELECT 1 FROM subscriptions
WHERE email = ? AND status IN ('active', 'trialing');
```

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
| イベント | 下の5つ |

送信するイベント:

- `checkout.session.completed` — 申し込み完了（**メールアドレスはここで分かります**）
- `customer.subscription.created` — 契約開始
- `customer.subscription.updated` — 解約予約・プラン変更・支払い失敗
- `customer.subscription.deleted` — 契約終了（期間末に届く）
- `customer.updated` — メールアドレスの変更

登録すると `whsec_...`（署名シークレット）が表示されます。これを手順4で登録してください。

## テストモードで試す

Stripeを**テストモード**に切り替えると、テストカード `4242 4242 4242 4242` を使い、
実際のお金を動かさずに申し込みから解約まで何度でも試せます。

1. Stripeダッシュボード右上の切り替えで「**テストモード**」にする
2. 「開発者」→「Webhook」→ **同じURL**でエンドポイントを作る（イベントも同じ5つ）
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
npm run schema:local      # ローカル用DBにテーブルを作る（初回のみ）
npx wrangler dev          # http://127.0.0.1:8787 で起動
npm test                  # 別のターミナルで実行
```

`npm test` は署名検証・二重受信・解約・通知の順序入れ替わりを確認します（13項目）。
ローカルでは `.dev.vars` の `STRIPE_WEBHOOK_SECRET` が使われます（Git管理外）。

## セキュリティ上の要点

- **署名検証**: Stripe以外から送られた偽の通知は受け付けません（HMAC-SHA256で照合）
- **リプレイ対策**: 5分以上前のタイムスタンプの通知は拒否します
- **二重処理の防止**: 同じイベントIDは1回しか処理しません
- **失敗時の再送**: 処理に失敗した場合は500を返し、Stripeが自動で再送します
