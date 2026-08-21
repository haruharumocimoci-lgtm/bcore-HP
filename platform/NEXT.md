# 次にやること（引き継ぎメモ）

最終更新: 2026-08-21

## いまの状態

| 項目 | 状態 |
| --- | --- |
| HP（解約ページ・解約ボタン） | ✅ 公開済み |
| Stripe 本番の支払いリンク3つ | ✅ 設定済み |
| 解約ルール（いつでも解約可・期間末日まで利用可・返金なし） | ✅ 反映済み |
| Webhook受信Worker | ✅ 公開・動作確認済み |
| 会員データベース（Cloudflare D1 `bcore-members`） | ✅ 記録を確認 |
| プラン（online / offline）の判別 | ✅ 自動化した（設定不要） |
| 入室チェックAPI `/api/members/check` | ✅ 実装・テスト済み（**要: 合言葉の登録**） |
| 講義プラットフォーム本体 | ⬜ 未着手（何で作るかの決定待ち） |

公開URL: https://bcore-hp.haruharumocimoci.workers.dev
- `/health` … 合言葉が届いているかを確認できる
- `/stripe/webhook` … Stripeに登録済み（本番・テスト両モード）
- `/api/members/check` … 入室チェック（`MEMBER_API_KEY` を登録すると使えるようになる）

> シークレットは Cloudflare の「変数とシークレット」（ビルド側）に入れ、
> デプロイコマンドの末尾で `wrangler secret put` して実行環境へコピーしている。
> この仕組みのため、合言葉を変えたら再ビルドが必要。

---

## A. すぐやること

### A-1. ⚠️ 解約ボタンの飛び先を確認する（いちばん優先）

`index.html` の解約ボタンのURLが、**ONLINEの支払いリンクと同じID**になっている。

```
支払いリンク（ONLINE）  https://buy.stripe.com/fZufZgbia8HSc358Bq5Vu00
カスタマーポータル      https://billing.stripe.com/p/login/fZufZgbia8HSc358Bq5Vu00
                                                        ^^^^^^^^^^^^^^^^^^^^^^^ 同じ
```

3つの支払いリンクのIDは末尾が `5Vu00` `5Vu01` `5Vu03` と揃っており、
**支払いリンク側は正しそう**。一方カスタマーポータルのURLは本来まったく別のIDになるはずなので、
**解約ボタンの側にONLINEのURLを貼ってしまった可能性が高い**（前回のメモとは逆の見立て）。

そのままだと、お客さんが「解約」を押してもStripeのエラーページに飛ぶ。

確認方法:

| 開くURL | 正しいときに出る画面 |
| --- | --- |
| https://b-core.space/#cancel の解約ボタン | メールアドレスを入れる「お客様ポータル」の画面 |
| https://b-core.space/#price の ONLINE「申し込む」 | ¥5,500 の決済画面 |

エラーページや違う画面が出たら、Stripeダッシュボードから取り直す。

- カスタマーポータル: 「設定」→「請求」→「カスタマーポータル」→ ページ下部の「ログインリンクを共有する」
- 支払いリンク: 「商品カタログ」→ 商品 →「支払いリンク」

貼る場所は `index.html` の1365行目付近（`STRIPE_PORTAL` / `STRIPE_LINKS`）。

### A-2. 入室チェックAPIの合言葉を登録する

講義プラットフォームを作る前でも、先に済ませておける。

```sh
cd platform
openssl rand -base64 32          # 出てきた文字列をコピー
npx wrangler secret put MEMBER_API_KEY
```

登録できたかの確認:

```sh
curl https://bcore-hp.haruharumocimoci.workers.dev/health
# → "memberApi":true になっていればOK
```

> Cloudflareの「変数とシークレット」（ビルド側）にも同じ値を入れておくこと。
> 他のシークレットと同じ仕組みで、再ビルドのときに実行環境へコピーされる。

### A-3. テストデータを消す（本番の申し込みが入る前に）

いまデータベースに入っているのはテストモードのデータだけ（本番の会員はまだ0人）。
**入室チェックAPIの動作確認に使えるので、確認が済んでから消すのがおすすめ。**

```sql
DELETE FROM subscriptions  WHERE is_test = 1;
DELETE FROM customers      WHERE is_test = 1;
DELETE FROM webhook_events WHERE is_test = 1;
```

```sh
npx wrangler d1 execute bcore-members --remote --command "DELETE FROM subscriptions WHERE is_test = 1;"
```

> 本番の会員（`is_test = 0`）は消えません。テストモードのデータだけが対象です。

---

## B. 講義プラットフォーム（本題）

作るのは本人。**B-CORE側の「この人は有効な会員か」を答える部分は完成している。**

```
講義プラットフォーム
   ↓ メールアドレスを送る（合言葉つき）
POST /api/members/check
   ↓
{"member": true, "plan": "online", ...}
   ↓
入室させる／断る
```

使い方の詳細は `platform/README.md` の「入室チェックAPI」を参照。

### B-1. 決めること（ここが決まらないと次に進めない）

- **何で作るか** … Discord / ノーコード（STUDIO・Wixなど）/ WordPress / 自作
  → これで下の繋ぎ方が決まる
- **動画の置き場所** … YouTube限定公開（無料）/ Cloudflare Stream（有料・転載されにくい）
- **ライブ配信** … ZoomのURLを会員ページに載せる形なら追加費用ゼロ

### B-2. 繋ぎ方（作るもので変わる）

| 作るもの | 繋ぎ方 | B-CORE側に追加で必要なもの |
| --- | --- | --- |
| ログイン機能があるもの（WordPress・自作など） | ログイン時に `/api/members/check` を呼ぶ | **なし（完成済み）** |
| ログイン機能がないもの（ノーコードの会員ページなど） | メール認証 → 署名付きの入室リンクを発行 | ワンタイムリンクの発行とメール送信 |
| Discord / Slack | 会員だけを自動で招待・自動で退出させる | Discord Botの用意 |

いちばん上（そのまま使える）で済むかどうかが分かれ目。

### B-3. セキュリティ

`MEMBER_API_KEY` は**サーバー側だけ**に置くこと。
ブラウザで動くJavaScriptに書くと、他人のメールアドレスが会員かどうかを誰でも調べられてしまう。

---

## C. 積み残し（急がないもの）

- 会社用メールアドレスができたら `harutomochimaru@icloud.com` を一括置換（`index.html` 内5箇所）
- STORE と COACH の写真（いまはプレースホルダー）
- テスト用カスタマーポータルのログインリンク（`STRIPE_TEST_PORTAL`、`index.html` 1366行目）
  ※ `?test=1` で解約の流れも試したい場合のみ必要
