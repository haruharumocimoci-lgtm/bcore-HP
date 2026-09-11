# 次にやること（引き継ぎメモ）

最終更新: 2026-09-11

## いまの状態

| 項目 | 状態 |
| --- | --- |
| HP（解約ページ・解約ボタン） | ✅ 公開済み |
| Stripe 本番の支払いリンク3つ | ✅ 設定済み（ONLINE ¥5,500 は決済画面まで確認） |
| 解約ポータル（カスタマーポータル） | ✅ 設定済み・動作確認済み |
| プラン価格ID（`plan` 欄への記録） | ✅ 設定済み（`/health` の `prices` で反映を確認できる） |
| 解約ルール（いつでも解約可・期間末日まで利用可・返金なし） | ✅ 反映済み |
| Webhook受信Worker | ⏸ 当面使わない。会員判定は Stripe を直接見る方針（0-1参照） |
| 会員データベース（Cloudflare D1 `bcore-members`） | ⏸ 当面使わない（中身はテストモードの記録のみ） |
| 講義プラットフォーム | ⬜ 未着手 |
| 本番の会員 | 0件（2026-08-28 の1件は払い戻し済み）|

公開URL: https://bcore-hp.haruharumocimoci.workers.dev
- `/health` … 合言葉が届いているかを確認できる
- `/stripe/webhook` … テストモードのみ登録が生きている。本番モードは登録しない（0-1参照）

> シークレットは Cloudflare の「変数とシークレット」（ビルド側）に入れ、
> デプロイコマンドの末尾で `wrangler secret put` して実行環境へコピーしている。
> この仕組みのため、合言葉を変えたら再ビルドが必要。

---

## 0. Stripeから届いた通知への対応

### 0-1. 会員判定は Stripe を直接見る ✅ 方針決定（残作業: example.com の削除）

**本番モードの通知は、これまで一度もこの Worker に届いていない。**
ただし Stripe の配信自体は失敗していない — 別の宛先 `https://bcoreform.com/api/stripe/webhook`
が本番の通知を受け取っており、そちらは成功している。

D1 を直接確認した結果（2026-09-11）:

| 確認したこと | 結果 |
| --- | --- |
| `webhook_events` の中身 | 10件すべて `is_test = 1`。本番モードは**0件** |
| 最後に受信した通知 | 2026-08-28 01:28 UTC（テストモード） |
| `subscriptions` の本番会員 | **0件**（`customers` も本番は0件） |

```sh
# 再確認するとき
npx wrangler d1 execute bcore-members --remote \
  --command "SELECT is_test, COUNT(*) FROM webhook_events GROUP BY is_test;"
```

#### 何が起きたか

Stripeの失敗メールの時刻と突き合わせると、原因がはっきりする。

| 日時 (UTC) | 出来事 |
| --- | --- |
| 08-21 10:27 〜 08-24 | 本番の送信先が workers.dev。エラー14件 + HTTP 500 が2件（合言葉の登録前） |
| （この間に送信先が差し替わった） | 本番の送信先が bcoreform.com 系に移る。同時に `https://example.com/api/stripe/webhook` という打ち間違いの行も作られる |
| **08-28 02:05:58** | **最初の本番申し込み ¥5,500（ONLINE / `cus_V9YG3H3s81mqfU`）** |
| **08-28 02:10:27** | example.com への配信失敗が始まる（= この時点の送信先は example.com） |
| 08-31 / 09-10 | 失敗メール。9/7以降だけで17回失敗。9/16 にStripeが送信を停止する |

`example.com` は `bcoreform.com` の**打ち間違い**とみられる。パスが
`/api/stripe/webhook` で完全に一致しており、Next.js 系アプリの慣習的な置き場所。
プレースホルダのドメインを直し忘れた行が、そのまま残っているのだろう。

#### いま分かっていること / 分かっていないこと

| | |
| --- | --- |
| ✅ 確認済み | この Worker の D1 に本番の記録は0件（`webhook_events` 10件すべて `is_test = 1`） |
| ✅ 確認済み | 本番の通知は bcoreform.com が受け取っており、配信は失敗していない |
| ✅ 確認済み | bcoreform.com はこのGitHubアカウント（全12リポジトリ）にも、このCloudflareアカウント（Worker 1件・D1 1件）にも無い。別の場所でホストされている |
| ❓ 未確認 | bcoreform.com が受け取った通知で**何を記録しているか**。会員データを持っているのか、通知を見ているだけなのか |

> テストモードの通知だけはこの Worker に届いていた（10件）。
> そのため `/health` やテストでは異常に見えなかった。

#### 方針（2026-09-11 決定）：Stripe を正解とする

**会員の状態は Stripe を直接見て判断する。** ローカルに会員データベースを
持たない。「誰がどの商品を買っているか」は Stripe が既に正確に持っているので、
それを写し取って二重管理する必要がない、という判断。

この方針だと、こうなる:

| | |
| --- | --- |
| `platform/`（Worker + D1 `bcore-members`） | **当面は不要**。Webhookを受けて写しを作るのが役目だったため |
| Webhookの再登録（workers.dev を本番モードへ） | **不要** |
| `https://example.com/api/stripe/webhook` の削除 | **必要**（打ち間違いの残骸。9/16 までStripeが失敗メールを送り続ける） |
| `https://bcoreform.com/api/stripe/webhook` | そのまま。触らない |

#### 「誰がどの商品か」の調べ方

**画面で見る場合** … https://dashboard.stripe.com/subscriptions
ステータスや商品で絞り込める。日常はこれで足りる。

**コマンドで一覧が欲しい場合** … 有効な契約を顧客ごと全部出す:

```sh
curl -G https://api.stripe.com/v1/subscriptions \
  -u "sk_live_xxxxx:" \
  -d status=active \
  -d limit=100 \
  -d "expand[]=data.customer"
```

**メールアドレスから1人分を引く場合**:

```sh
curl -G https://api.stripe.com/v1/customers \
  -u "sk_live_xxxxx:" \
  -d email="shirabetai@example.com" \
  -d "expand[]=data.subscriptions"
```

`subscriptions.data[].status` が `active` / `trialing` なら有効な会員。
`subscriptions.data[].items.data[0].price.id` がプラン（ONLINE / OFFLINE）。

> 解約すると期間末日まで `active` のままなので、
> HPに書いた「お支払い済みの期間の末日までご利用いただけます」と自動で一致する。
> この性質は D1 を使っていたときと変わらない。

#### この方針の限界（将来ぶつかったら考えること）

- 講義プラットフォーム側で**自動的に入室制御**したくなったら、その都度 Stripe API を
  叩くことになる（1回あたり0.2〜0.5秒）。人数が数百人規模までならこれで足りる
- Stripe APIが落ちている間は判定できない。写しを持たない以上これは避けられない
- 照会する場所に `sk_live_...` を置く必要がある。ブラウザ側には絶対に置かないこと

これらが問題になった時点で、改めて写し（D1）を作ればよい。
`platform/` のコードはそのとき再利用できる。

### 0-2. 受信Workerの修正 ✅ 対応済み

再発時に原因を追えるよう、2点修正した（`src/index.js`）。

- D1に触れなかったときに素の例外で落ちる代わりに、理由をログに残して500を返す
  （Stripeが自動で再送する。8/24 の HTTP 500 はこの経路の可能性が高い）
- `checkout.session.completed` のメールアドレスを小文字に正規化する。
  `subscriptions.email` は入室チェックの照合先で、`schema.sql` が求める
  「必ず小文字で保存する」に `customers` 側だけが従っていた

> ⚠️ この修正は作業ブランチにあるだけで、**まだ本番のWorkerには入っていない**。
> デプロイ済みのコードは修正前の状態（Cloudflareで確認済み）。

### 0-3. 再発を防ぐ

テストモードだけが通っていても気づけなかったのが今回の反省点。
本番の通知が生きているかは、次のどちらかで見るとよい。

- Stripeダッシュボードの「Webhook」→ 本番エンドポイントの成功率
- D1: `SELECT MAX(received_at) FROM webhook_events WHERE is_test = 0;`

---

## A. 仕上げ（あと少し）

### A-1. 失敗したWebhookイベントを再送信する ⏹ 対応不要

再送したが、記録済みのイベントIDは二重処理防止の仕組みで飛ばされるため
（`src/index.js` の webhook_events による重複チェック）、データは変わらなかった。

> ⚠️ Stripe画面の 200 は「処理して成功」と「重複なので飛ばした」の区別がつかない。
> 反映されたかどうかは D1 の中身で確認すること。

ただしここで扱ったデータは全件テストモード（`is_test = 1`）で、A-4 でどのみち消す。

> 2026-08-28 の本番申し込みはD1に届いていないが、払い戻し済みのため追う必要はない。0-1 を参照。

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

> ⚠️ 2026-09-11 の方針変更により、**この章の「D1を見て判定する」前提は無効**。
> 判定は Stripe API を直接叩く形になる（0-1参照）。下の候補はその前提で読むこと。

### B-2. 繋ぎ方の候補
1. **入室チェックAPI** … メールアドレスを投げると有効/無効が返る。
   プラットフォーム側にログイン機能がある場合はこれが最短。
2. **ワンタイム入室リンク** … B-CORE側でメール認証し、署名付きURLで送り込む。
   プラットフォーム側にログイン機能が無くてもよい。
3. **自動招待・自動退出** … Discord / Slack などのAPIを叩く。

判定の中身は 0-1 の `curl` と同じ。メールアドレスで顧客を引き、
`subscriptions.data[].status` が `active` / `trialing` かを見る。

解約すると期間末日まで `active` のままなので、HPの解約ルールと自動で一致する。

### B-3. セキュリティ
どの方式でもAPIキーで保護する。他人が会員かどうかを勝手に調べたり、
なりすまして入室したりできないようにする。

---

## C. 積み残し（急がないもの）

- テスト用カスタマーポータルのログインリンク（`STRIPE_TEST_PORTAL`）
  ※ `?test=1` で解約の流れも試したい場合のみ必要
