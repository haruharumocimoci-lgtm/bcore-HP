# B-CORE FORM — 会員限定 動画プラットフォーム

サブスク会員限定の講座動画視聴サイトです。公開URL: **https://bcoreform.com**

```
[会員]                       [オーナー]
  │ 会員登録（無料）             │ 動画をアップロード（管理画面 → Cloudflare Stream）
  │ ログイン                     │ Notionの台帳で講座・動画を編集
  ▼                             ▼
┌──────────────────────────────────────────────┐
│  bcoreform.com（Next.js on Cloudflare Workers）│
│   ・認証: Supabase（メール＋パスワード / Google）│
│   ・視聴判定: Stripe Webhook → Supabase / D1    │
│   ・再生: Cloudflare Stream 署名付きURL（2時間） │
└──────────────────────────────────────────────┘
  ▲                             ▲
  │ Stripe支払いリンクで決済       │ checkout.session.completed 等のWebhook
[b-core.space（既存HP）]      [Stripe]
```

- **決済フォームはこのサイトには無い。** 決済は既存HP（b-core.space）のStripe支払いリンクで行う
- 会員は**決済時のメールアドレス**と**このサイトの登録メールアドレス**で照合される
- 動画は署名付きの短命URL（2時間で失効）でのみ再生され、生の動画URLは露出しない
- 講座・動画の追加/編集/公開はNotionの「講座台帳」「動画台帳」で行う（サイトへ自動反映）

## ディレクトリ

| パス | 内容 |
| --- | --- |
| `src/app/` | 画面とAPI（Next.js App Router） |
| `src/lib/` | 会員判定・Stream署名・Notion同期・Stripe Webhook処理 |
| `supabase/migrations/0001_init.sql` | Supabaseのテーブル定義（初回に1度実行する） |
| `wrangler.jsonc` | Cloudflare Workerの設定（独自ドメイン bcoreform.com を含む） |
| `.env.example` | 必要な環境変数の一覧と説明 |

## 主なURL

| URL | 内容 |
| --- | --- |
| `/` | 講座一覧（誰でも閲覧可） |
| `/courses/{id}` | 講座の動画一覧 |
| `/watch/{id}` | 視聴ページ（ログイン必須。会員のみ再生可） |
| `/login` `/signup` | ログイン・会員登録（無料） |
| `/account` | マイページ（契約状態の確認） |
| `/admin` | 管理画面（`ADMIN_EMAILS` のアカウントのみ） |
| `/api/stripe/webhook` | Stripe Webhook受信（Stripeダッシュボードに登録する） |

---

# 初回セットアップ手順

すべてダッシュボード上の操作です。上から順に進めてください。

## 1. Supabase（認証・データベース）

1. https://supabase.com/dashboard でプロジェクト `rllpjenzdxhpwrtispye` を開く。
   **休止中（Paused）と表示されたら「Restore project」を押して再開する**（無料）
2. SQL Editor に `supabase/migrations/0001_init.sql` の中身を貼り付けて実行
3. Project Settings → API から以下をメモ:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon public キー → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role キー → `SUPABASE_SERVICE_ROLE_KEY`（**秘密**）
4. Authentication → URL Configuration:
   - Site URL: `https://bcoreform.com`
   - Redirect URLs: `https://bcoreform.com/auth/callback` を追加
5. （Googleログインを使う場合）Authentication → Providers → Google を有効化。
   Google Cloud Console で OAuth クライアントを作り、Client ID / Secret を貼る。
   承認済みリダイレクトURIには Supabase が表示する `https://<project>.supabase.co/auth/v1/callback` を登録

## 2. Cloudflare Stream（動画配信）

アカウントID・カスタマーサブドメイン・署名キーは**発行済み**です。

| 変数 | 状態 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ `.env.example` に記録済み（**必ず小文字**。大文字混じりだとAPIが404を返す） |
| `STREAM_CUSTOMER_CODE` | ✅ `.env.example` に記録済み |
| `STREAM_SIGNING_KEY_ID` | ✅ 発行済み（`08692124b741425543545cdf7919d455`） |
| `STREAM_API_TOKEN` | 🔑 秘密。Cloudflareの「変数とシークレット」に設定する |
| `STREAM_SIGNING_KEY_JWK` | 🔑 秘密。同上 |

**このセットアップですることは、秘密の2つ（🔑印）を Cloudflare の「変数とシークレット」に貼るだけ**です。
値の発行作業はすべて完了しています。

> 署名キーとは: 動画の「入場券を発行するためのハンコ」です。視聴のたびにサーバーが
> 2時間だけ有効な入場券を作り、それが付いたURLでしか再生できません。
> URLを他人に送っても再生できないので、又貸しやダウンロードを防げます。

なお Stream の利用には課金の有効化が必要です（$5/月〜。保存分数と視聴時間で課金）。

<details>
<summary>万一なくしたときの作り直し手順（普段は不要）</summary>

- APIトークン: マイプロフィール → APIトークン → 「トークンを作成」→ 権限 **Stream:編集**
- 署名キー（作り直すと、古いキーで発行済みの再生URLは無効になります）:
  ```sh
  curl -X POST "https://api.cloudflare.com/client/v4/accounts/<アカウントID>/stream/keys" \
       -H "Authorization: Bearer <STREAM_API_TOKEN>"
  ```
  返ってきたJSONの `result.id` を `STREAM_SIGNING_KEY_ID` に、
  `result.jwk` を `STREAM_SIGNING_KEY_JWK` に設定します。

</details>

## 3. Notion（講座・動画の台帳）

台帳データベースは作成済み:

- 講座台帳: データベースID `ffb4fbb899b4469480bb9d9452e67bab`
- 動画台帳: データベースID `e8c46689417e45b2ae4e882aa1ea0014`

1. https://www.notion.so/my-integrations → 「新しいインテグレーション」を作成（対象ワークスペースを選ぶ）
2. 表示されるトークン → `NOTION_TOKEN`（**秘密**）
3. Notionで「講座台帳」「動画台帳」それぞれを開き、右上「…」→「接続」→ 作ったインテグレーションを追加
4. `NOTION_COURSES_DB_ID` / `NOTION_VIDEOS_DB_ID` に上記IDを設定

## 4. Cloudflare Workers へのデプロイ（Git連携）

1. Cloudflareダッシュボード → Workers & Pages → 「作成」→「Workers」→ **リポジトリをインポート**
   → `haruharumocimoci-lgtm/bcore-HP` を選択
2. 設定:
   - プロジェクト名: `bcoreform`
   - 本番ブランチ: `claude/notion-platform-build-we9k26`（またはこの内容を取り込んだブランチ）
   - **ルートディレクトリ: `app`**
   - ビルドコマンド: `npx opennextjs-cloudflare build`
   - デプロイコマンド: `npx wrangler deploy`
3. **ビルド時の環境変数**（ビルド設定画面）に設定:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. デプロイ後、Workerの **設定 → 変数とシークレット** に残りを設定（`.env.example` 参照）:
   - シークレット: `SUPABASE_SERVICE_ROLE_KEY` / `STRIPE_WEBHOOK_SECRET` / `STREAM_API_TOKEN` / `STREAM_SIGNING_KEY_JWK` / `NOTION_TOKEN`
   - 変数: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `CLOUDFLARE_ACCOUNT_ID` / `STREAM_SIGNING_KEY_ID` / `STREAM_CUSTOMER_CODE` / `NOTION_COURSES_DB_ID` / `NOTION_VIDEOS_DB_ID` / `ADMIN_EMAILS` / `PRICE_ONLINE` / `PRICE_OFFLINE` / `STRIPE_LINK_ONLINE` / `STRIPE_LINK_OFFLINE`
   - 設定後にもう一度デプロイ（「デプロイを再実行」）すると反映される

### 独自ドメイン（bcoreform.com）

`wrangler.jsonc` に `bcoreform.com` / `www.bcoreform.com` のカスタムドメイン設定が入っています。
**bcoreform.com のゾーンが同じCloudflareアカウントにあれば、デプロイ時に自動で接続されます**（DNSレコードも自動作成）。
別アカウントにゾーンがある場合は、ゾーン側アカウントに Worker を作るか、`routes` を書き換えてください。

## 5. Stripe（Webhook）

1. https://dashboard.stripe.com → 開発者 → Webhook → 「エンドポイントを追加」
   - URL: `https://bcoreform.com/api/stripe/webhook`
   - イベント: `checkout.session.completed` / `customer.created` / `customer.updated` /
     `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted`
2. 発行された `whsec_...` を Worker のシークレット `STRIPE_WEBHOOK_SECRET` に設定
3. テストモードでも同じURLでエンドポイントを作り、その `whsec_...` を `STRIPE_WEBHOOK_SECRET_TEST` に設定（任意）
4. `STRIPE_SECRET_KEY`（`sk_live_...`）も設定しておくと、通知の順番が前後してもメール照合が確実になる（推奨）

> 既存の Webhook Worker（`bcore-hp` / D1 `bcore-members`）はそのまま並行稼働できます。
> このサイトは Supabase に契約が見つからない場合、自動で D1 も参照するため、
> 過去の契約データもそのまま有効です。

### 別サイト（既存HP）側で必要なこと

- 支払いリンク（`buy.stripe.com/...`）はそのままでOK。**追加の実装は不要**
- 会員には「動画サイトに登録したメールアドレスで決済してください」と案内する
- なお、この動画サイトの未契約者向け案内には `STRIPE_LINK_ONLINE` / `STRIPE_LINK_OFFLINE`
  を設定すると申し込みボタンが直接表示され、`?prefilled_email=登録メール` 付きで
  Stripeのチェックアウトに飛ぶため、メールの入力ずれを防げる（推奨）

## 6. 動作確認チェックリスト

1. `https://bcoreform.com/` が開き、サンプル講座が表示される（表示されなければ `/admin` で「Notionから同期」）
2. 会員登録 → ログインできる（Googleログインも）
3. `ADMIN_EMAILS` のアカウントでログイン → `/admin` が開き、設定状況がすべて ✅
4. `/admin/videos` から動画をアップロード → 動画IDをNotion動画台帳に貼り、「公開」チェック → 同期
5. Stripeのテストモードで決済（カード `4242 4242 4242 4242`）→ 対象メールのアカウントで動画が再生できる
6. テスト解約 → 期間末日経過後（またはStripeでの即時キャンセル後）に視聴がブロックされる

---

# ローカル開発

```sh
cd app
npm install
cp .env.example .env.local   # 値を埋める
npm run dev                  # http://localhost:3000

# Workers実行環境での確認（本番同等）
npm run cf:preview
```

# セキュリティ上の要点

- Stripe署名検証（HMAC-SHA256・タイムスタンプ許容300秒・二重処理防止・失敗時はStripeが再送）
- 動画は `requireSignedURLs: true` でアップロードされ、再生には2時間で失効する署名付きトークンが必須
- トークン発行APIはログイン＋有効サブスクを毎回確認する（無料サンプル動画のみログインだけで可）
- Supabase は RLS 有効。ブラウザからは「公開中の講座・動画」「自分のプロフィール・契約」しか読めない
- `SUPABASE_SERVICE_ROLE_KEY` などのシークレットは Cloudflare の「変数とシークレット」のみに保存し、
  リポジトリ・Notion・HTMLには絶対に書かない
