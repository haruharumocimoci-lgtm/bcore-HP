# 次にやること（引き継ぎメモ）

最終更新: 2026-08-30

## いまの状態

| 項目 | 状態 |
| --- | --- |
| HP（解約ページ・解約ボタン） | ✅ 公開済み |
| Stripe 本番の支払いリンク3つ | ✅ 設定済み |
| 解約ルール（いつでも解約可・期間末日まで利用可・返金なし） | ✅ 反映済み |
| Webhook受信Worker | ✅ 公開・動作確認済み |
| 会員データベース（Cloudflare D1 `bcore-members`） | ✅ 記録を確認 |
| 講義プラットフォーム | ⬜ 未着手 |

公開URL: https://bcore-hp.haruharumocimoci.workers.dev
- `/health` … 合言葉が届いているかを確認できる
- `/stripe/webhook` … Stripeに登録済み（本番・テスト両モード）

> シークレットは Cloudflare の「変数とシークレット」（ビルド側）に入れ、
> デプロイコマンドの末尾で `wrangler secret put` して実行環境へコピーしている。
> この仕組みのため、合言葉を変えたら再ビルドが必要。

---

## A. 仕上げ（あと少し）

### A-1. 失敗したWebhookイベントを再送信する
Stripe →「開発者」→「Webhook」→ エンドポイント →「イベントの配信」で
`500 ERR` のまま残っている行（`checkout.session.completed` など）を **再送信**。

→ これで `subscriptions.email` が埋まる（いまは NULL）。

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

### A-3. HPのONLINE支払いリンクを検証する
`index.html` の `STRIPE_LINKS.online` が、カスタマーポータルのURLと
同じID（`fZufZgbia8HSc358Bq5Vu00`）になっている。コピーミスの可能性あり。

確認方法: `https://b-core.space/#price` の ONLINE「申し込む」を押す
- ¥5,500の決済画面が出る → 問題なし
- メールアドレス入力画面が出る → URLが違うので商品カタログから取り直す

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
