# 次にやること（引き継ぎメモ）

最終更新: 2026-09-10

## いまの状態

| 項目 | 状態 |
| --- | --- |
| HP（解約ページ・解約ボタン） | ✅ 公開済み |
| Stripe 本番の支払いリンク3つ | ✅ 設定済み（ONLINE ¥5,500 は決済画面まで確認） |
| 解約ポータル（カスタマーポータル） | ✅ 設定済み・動作確認済み |
| プラン価格ID（`plan` 欄への記録） | ✅ 設定済み（`/health` の `prices` で反映を確認できる） |
| 解約ルール（いつでも解約可・期間末日まで利用可・返金なし） | ✅ 反映済み |
| Webhook受信Worker | ✅ 公開・動作確認済み |
| 会員データベース（Cloudflare D1 `bcore-members`） | ✅ 記録を確認 |
| 講義プラットフォーム | ⬜ 未着手 |
| 本番の会員 | 1件（2026-08-28 に最初の申し込み。ONLINE ¥5,500） |

公開URL: https://bcore-hp.haruharumocimoci.workers.dev
- `/health` … 合言葉が届いているかを確認できる
- `/stripe/webhook` … Stripeに登録済み（本番・テスト両モード）

> シークレットは Cloudflare の「変数とシークレット」（ビルド側）に入れ、
> デプロイコマンドの末尾で `wrangler secret put` して実行環境へコピーしている。
> この仕組みのため、合言葉を変えたら再ビルドが必要。

---

## 0. Stripeから届いた通知への対応

### 0-1. `https://example.com/api/stripe/webhook` を削除する ⚠️ 要対応（期限 2026-09-16）

Stripeから「Webhook の配信に関する問題」というメールが繰り返し届いている
（2026-08-31 / 2026-09-10）。宛先はこのURL:

```
https://example.com/api/stripe/webhook
```

`example.com` は**説明用のダミーのドメイン**で、B-CORE とは無関係。
このリポジトリのどこにも出てこない。Stripeダッシュボードに登録されたまま
残っている設定ミスなので、**コードでは直せない**。

対応（Stripeダッシュボードでの操作）:

1. https://dashboard.stripe.com/webhooks を開く（本番モード）
2. `https://example.com/api/stripe/webhook` の行を開く
3. 「…」→「エンドポイントを削除」

放っておいても支払いや入金には影響しない（2026-09-16 にStripeが送信を止める）が、
失敗メールが届き続けるので消しておくこと。

> 正しいエンドポイントは `https://bcore-hp.haruharumocimoci.workers.dev/stripe/webhook` の1つだけ。
> 本番モードとテストモードにそれぞれ1件ずつ登録されている状態が正解。

### 0-2. workers.dev 側の配信エラー ✅ 解消済み

2026-08-24 に `https://bcore-hp.haruharumocimoci.workers.dev/stripe/webhook` でも
失敗メールが届いていた（8/21〜8/24、その他エラー14件 + HTTP 500 が2件）。
合言葉（`STRIPE_WEBHOOK_SECRET`）の登録前だった時期のもので、
その後この宛先の失敗メールは届いていない。

再発時の切り分けのため、次の2点を修正済み:

- D1（データベース）に触れなかったときに、Workerが素の例外で落ちるのではなく
  理由をログに残して500を返すようにした（Stripeが自動で再送してくれる）
- `checkout.session.completed` で受け取ったメールアドレスを小文字に揃えるようにした
  （`subscriptions.email` は入室チェックの照合先。大文字が混ざると会員判定が外れる）

### 0-3. 最初の本番会員がD1に入っているか確認する ⚠️ 要確認

2026-08-28 に本番モードで最初の申し込みが入った（ONLINE ¥5,500 / `cus_V9YG3H3s81mqfU`）。
Webhookが正常に受け取れていれば、次のSQLで1件返るはず。

```sh
npx wrangler d1 execute bcore-members --remote \
  --command "SELECT email, plan, status, current_period_end FROM subscriptions WHERE is_test = 0;"
```

0件だった場合は、Stripeダッシュボードの「開発者」→「Webhook」→
該当エンドポイントの「イベントの配信」から 2026-08-28 のイベントを再送信する
（`checkout.session.completed` と `customer.subscription.created` の2つ）。

---

## A. 仕上げ（あと少し）

### A-1. 失敗したWebhookイベントを再送信する ⏹ 対応不要

再送したが、記録済みのイベントIDは二重処理防止の仕組みで飛ばされるため
（`src/index.js` の webhook_events による重複チェック）、データは変わらなかった。

> ⚠️ Stripe画面の 200 は「処理して成功」と「重複なので飛ばした」の区別がつかない。
> 反映されたかどうかは D1 の中身で確認すること。

ただしここで扱ったデータは全件テストモード（`is_test = 1`）で、A-4 でどのみち消す。

> 2026-08-28 に本番モードの申し込みが1件入っている。こちらの記録の有無は 0-3 で確認すること。

### A-2. プランの価格IDを設定する ✅ 完了

本番モードの `price_id` を `platform/wrangler.toml` の `[vars]` に設定済み。

```toml
[vars]
PRICE_ONLINE  = "price_1U5xPOAZRcjZV00NgOdw0Y6a"   # ONLINE  ¥5,500/月
PRICE_OFFLINE = "price_1U5xPOAZRcjZV00NHLzLpy6l"   # OFFLINE ¥9,900/月
```

これ以降に届く契約は `subscriptions.plan` に online / offline が入る。
設定前に届いた分を埋めたい場合は、Stripeの「開発者」→「Webhook」→「イベントの配信」から
該当イベントを再送信する（A-1と同じ操作）。

※ 本番モードとテストモードで price_id は別物。上記は本番用。
　 テストモードで確認したIDの例: `price_1U5lhCPOGqXMNRpUEWdDONc1`

### A-3. HPのONLINE支払いリンクを検証する ✅ 完了

`https://b-core.space/#price` の ONLINE「申し込む」から ¥5,500 の決済画面が出ることを確認済み。
`STRIPE_LINKS.online` は正しい。

### A-3b. 解約ポータルのリンクを検証する ✅ 完了

`https://b-core.space/#cancel` の「解約・お支払い情報の確認へ」から
メールアドレス入力画面が出ることを確認済み。`STRIPE_PORTAL` は正しい。

（ONLINE支払いリンクと末尾トークンが同一だったのは偶然。両方とも正しいリンク）

### A-4. テストデータを消す（本番運用の前に）
```sql
DELETE FROM subscriptions WHERE is_test = 1;
DELETE FROM customers     WHERE is_test = 1;
DELETE FROM webhook_events WHERE is_test = 1;
```

---

## B. 講義プラットフォーム（本題）

作るのは本人。B-CORE側は「この人は有効な会員か」を答える役。

### B-1. 決めること
- **何で作るか** … Discord / ノーコード / WordPress / 自作 など
  → これで繋ぎ方（下の3案）が決まる
- **動画の置き場所** … YouTube限定公開（無料）/ Cloudflare Stream（有料・転載されにくい）
- **ライブ配信** … ZoomのURLを会員ページに載せる形なら追加費用ゼロ

### B-2. 繋ぎ方の候補
1. **入室チェックAPI** … メールアドレスを投げると有効/無効が返る。
   プラットフォーム側にログイン機能がある場合はこれが最短。
2. **ワンタイム入室リンク** … B-CORE側でメール認証し、署名付きURLで送り込む。
   プラットフォーム側にログイン機能が無くてもよい。
3. **自動招待・自動退出** … Discord / Slack などのAPIを叩く。

判定に使うSQL:
```sql
SELECT 1 FROM subscriptions
WHERE email = ? AND status IN ('active','trialing') AND is_test = 0;
```

解約すると期間末日まで `active` のままなので、HPの解約ルールと自動で一致する。

### B-3. セキュリティ
どの方式でもAPIキーで保護する。他人が会員かどうかを勝手に調べたり、
なりすまして入室したりできないようにする。

---

## C. 積み残し（急がないもの）

- テスト用カスタマーポータルのログインリンク（`STRIPE_TEST_PORTAL`）
  ※ `?test=1` で解約の流れも試したい場合のみ必要
