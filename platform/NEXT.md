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
| 本番の会員 | 🟢 1件（2026-08-28 ONLINE ¥5,500） |
| 講義プラットフォーム | ⬜ 未着手 |

公開URL: https://bcore-hp.haruharumocimoci.workers.dev
- `/health` … 合言葉が届いているかを確認できる
- `/stripe/webhook` … Stripeに登録済み（本番・テスト両モード）

> シークレットは Cloudflare の「変数とシークレット」（ビルド側）に入れ、
> デプロイコマンドの末尾で `wrangler secret put` して実行環境へコピーしている。
> この仕組みのため、合言葉を変えたら再ビルドが必要。

---

## A. 仕上げ（あと少し）

### A-1. 失敗したWebhookイベントを再送信する ⏹ 対応不要

再送したが、記録済みのイベントIDは二重処理防止の仕組みで飛ばされるため
（`src/index.js` の webhook_events による重複チェック）、データは変わらなかった。

> ⚠️ Stripe画面の 200 は「処理して成功」と「重複なので飛ばした」の区別がつかない。
> 反映されたかどうかは D1 の中身で確認すること。

ただし当時のデータは全件テストモード（`is_test = 1`）で、A-4 でどのみち消す。
ここは追いかけなくてよい。
本物の申し込みは `checkout.session.completed` で email が入る。

> 📌 2026-08-28、**本番の初申し込みが入った**（ONLINE ¥5,500 / `cus_V9YG3H3s81mqfU`）。
> 以降は本番データ（`is_test = 0`）が混ざるので、A-4 の削除は `is_test = 1` 限定であることを必ず確認すること。

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

### A-4. テストデータを消す ⚠️ 要対応（優先度：高）

**本番の会員が入った後もテストデータが残ったまま。** 本番と混ざって見えるので早めに消す。
`is_test = 1` だけを消すこと（`is_test = 0` は本物の会員）。

```sql
DELETE FROM subscriptions WHERE is_test = 1;
DELETE FROM customers     WHERE is_test = 1;
DELETE FROM webhook_events WHERE is_test = 1;
```

### A-5. Stripeに残っている `example.com` のWebhook登録を削除する ⚠️ 要対応

Stripeから「Webhook の配信に関する問題」メールが繰り返し届いている（8/31、9/10）。
失敗しているのは実在しないプレースホルダーURL:

```
https://example.com/api/stripe/webhook
```

本物のエンドポイント（`https://bcore-hp.haruharumocimoci.workers.dev/stripe/webhook`）は
8/24 のエラーを最後に失敗メールが止まっており、正常に動いている。
つまり **`example.com` の登録が消し忘れで残っているだけ**なので、
Stripeダッシュボードの「開発者」→「Webhook」から削除すれば失敗メールは止まる。

- 削除先: <https://dashboard.stripe.com/b/acct_1U5M8JAZRcjZV00N?destination=%2Fwebhooks>
- 放置した場合、Stripe側が 2026-09-16 に自動で配信を停止する（実害はないがメールが届き続ける）

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
