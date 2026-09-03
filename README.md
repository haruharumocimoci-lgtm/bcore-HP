# B-CORE 公式HP

野球塾 B-CORE の公式ホームページ。ビルド不要の静的サイトで、`index.html` 1枚に完結しています（外部CDN・依存パッケージなし）。

## 公開リンク

- **一般公開URL（独自ドメイン）: https://b-core.space/**
  誰でもログインなしで見られます。お客さん・保護者へはこちらを共有してください。
  （`CNAME` ファイルで設定。DNSは GitHub Pages のIP `185.199.108〜111.153` を向いています）
- 予備URL（GitHub Pages 標準）: https://haruharumocimoci-lgtm.github.io/bcore-HP/
- 確認用ページ（Claude Artifact）: https://claude.ai/code/artifact/344e87af-7020-4222-9795-030fe3afa99c
  claude.aiのログインが必要なので、身内の確認用です。
- 原稿の編集台帳（Notion）: https://app.notion.com/p/3bdf8c123ef7818b858deb0b558ea72c

### GitHub Pages を有効にする（初回のみ）

リポジトリの **Settings → Pages** を開き、

1. Source: `Deploy from a branch`
2. Branch: `claude/press-share-feature-7rebih` / `(root)`
3. Save

数分待つと上記のURLで公開されます。以降は `index.html` をこのブランチにpushするたびに自動で更新されます。

> Pagesの配信元にしているブランチを削除すると公開が止まります。ブランチ名を変える場合は Settings → Pages の設定も合わせて変更してください。

## ファイル構成

| パス | 役割 |
| --- | --- |
| `index.html` | サイト本体。HTML・CSS・JSすべてを含む単一ファイル |
| `content/hp-content.md` | Notion編集台帳の本文スナップショット（差分確認用） |
| `scripts/build-artifact.mjs` | 共有用ページ（Artifact）に載せるファイルを生成 |
| `dist/artifact.html` | 上記スクリプトの生成物（Git管理外） |

## ローカルで見る

`index.html` をブラウザで開くだけで動きます。ローカルサーバーで見たい場合:

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

## 原稿を更新する手順

1. Notionの編集台帳で本文を書き換える（セクション見出し `HERO` `ABOUT` などは消さない）
2. Claudeに「NotionのHP編集台帳をHPに反映して」と伝える
3. Claudeが `index.html` と `content/hp-content.md` を更新し、共有用ページを差し替える

## 共有用ページを更新する

```sh
node scripts/build-artifact.mjs
```

生成された `dist/artifact.html` を、既存の共有URLに上書き公開します（URLは変わりません）。

## 未確定の項目

`index.html` 内に `TODO` コメントで印を付けてあります。決まり次第差し替えてください。

- テストモード用のカスタマーポータル ログインリンク（`index.html` 冒頭の `STRIPE_TEST_PORTAL`）※本番は設定済み。`?test=1` で解約の流れも試したい場合のみ必要
- STOREとCOACHの写真（現在はプレースホルダー表示）
- スパサブの在庫管理の有効化（Stripe側のID設定が必要。`platform/README.md`「在庫管理」）

## 規約ページ

Stripeの審査と継続課金のため、次の2ページを `index.html` 内に持っています（フッターからリンク）。

| ハッシュURL | 内容 |
| --- | --- |
| `https://b-core.space/#legal` | 特定商取引法に基づく表記 |
| `https://b-core.space/#privacy` | プライバシーポリシー |
| `https://b-core.space/#cancel` | 解約のお手続き（解約ボタン） |

事業者情報・解約/返金ルールを変更する場合は、`#page-legal` の `<dl class="legal__dl">` を直接編集してください。

## Stripeで決済を受け取る

このサイトはサーバーを持たない静的サイトなので、**Stripeの「支払いリンク（Payment Links）」** を使います。
Stripe側で作ったURLを `index.html` に貼るだけで、月謝の自動引き落とし（サブスク）まで対応できます。

### 1. Stripeダッシュボードで商品を作る

https://dashboard.stripe.com → 「商品カタログ」→「商品を追加」

| 項目 | ONLINE | OFFLINE |
| --- | --- | --- |
| 商品名 | B-CORE ONLINE | B-CORE OFFLINE |
| 金額 | 5,500円 | 9,900円 |
| 料金体系 | **継続（サブスクリプション）／ 月次** | **継続（サブスクリプション）／ 月次** |

> 表示価格は税込。Stripeの税設定を使わない場合は「税込価格として扱う」でOKです。

### 2. 支払いリンクを発行する

作った商品の画面から「支払いリンクを作成」。設定のおすすめ:

- **顧客情報を収集**: 氏名・電話番号・住所をON（誰の入金か分かるように）
- **カスタム項目**を追加: 「選手氏名」「学年・チーム名」など（申込フォーム代わりになります）
- **支払い後のページ**: `https://b-core.space/` に戻す、または確認メッセージを表示
- 発行された `https://buy.stripe.com/...` をコピー

### 3. サイトに貼る

`index.html` の `<script>` 冒頭にある設定を書き換えるだけです。

```js
const STRIPE_LINKS = {
  online:  'https://buy.stripe.com/xxxxxxxx',   // ONLINE  ¥5,500/月
  offline: 'https://buy.stripe.com/yyyyyyyy',   // OFFLINE ¥9,900/月
  spasub:  ''                                   // スパサブ ¥300（未設定なら購入ボタン非表示）
};
```

貼って push すると、PRICEページとJOINページの申し込みボタンがStripeの決済ページに繋がります。
空のままの項目は今まで通り「準備中」の案内が出るだけなので、片方だけ先に公開しても問題ありません。

### 4. 先にテストモードで確認する

本番リンクを貼る前に、**テスト決済だけ先に試せます**。
Stripeダッシュボードを「テストモード」に切り替えて発行したリンク（`https://buy.stripe.com/test_...`）を、
`index.html` の `STRIPE_TEST_LINKS` の側に貼ってください。

```js
const STRIPE_TEST_LINKS = {
  online:  'https://buy.stripe.com/test_xxxxxxxx',
  offline: 'https://buy.stripe.com/test_yyyyyyyy',
  spasub:  ''
};
```

| 開くURL | 使われるリンク |
| --- | --- |
| https://b-core.space/ （通常） | `STRIPE_LINKS`（本番） |
| https://b-core.space/?test=1 | `STRIPE_TEST_LINKS`（テスト） |
| ローカル表示（localhost・ファイル直開き） | `STRIPE_TEST_LINKS`（テスト） |

`?test=1` で開いたときだけ画面下に「Stripe テストモードで表示中」の黒い帯が出ます。
お客さんが見る通常のURLはテストリンクに繋がらないので、**本番リンクが空のままでも安全に確認できます**。

テスト決済に使うカード: `4242 4242 4242 4242` / 有効期限は未来の日付 / CVCは任意の3桁。

### 5. 本番の前に

- 入金を受け取るには Stripeダッシュボードで**本人確認と銀行口座の登録**が必要です
- 本番モードに切り替えて発行したURLを `STRIPE_LINKS` に貼れば、そのまま公開されます
- テスト用の `STRIPE_TEST_LINKS` は残しておいて問題ありません（`?test=1` のときしか使われません）

> 手数料の目安: 国内カード決済 3.6%（例: 5,500円 → 約199円）。サーバー代・月額固定費はかかりません。

## STOREの在庫表示（スパサブ）

STOREページは、会員基盤（`platform/`、Cloudflare Worker）の `/stock` から残り個数を読んで表示を切り替えます。

| 残り | 表示 |
| --- | --- |
| 51個以上 | 「購入する」ボタンのみ |
| 50個以下 | ボタン + 赤字で「残り ◯ 個」 |
| 0個 | 写真に「SOLD OUT」、ボタンは押せない「SOLD OUT」に変わる |

在庫はStripeで購入されるたびに自動で減り、全額返金で戻ります。**手で数える必要はありません。**
仕組みの詳細・在庫の補充・有効化の手順は `platform/README.md` の「在庫管理」を見てください。

`index.html` 冒頭の関連設定:

```js
const STOCK_API = 'https://bcore-hp.haruharumocimoci.workers.dev/stock';  // 在庫を読む先
const STOCK_LOW_THRESHOLD = 50;               // この数以下で「残り◯個」を出す
const STORE_FORCE_SOLD_OUT = { spasub: false };  // true にすると在庫に関係なく SOLD OUT（緊急用）
```

在庫APIに繋がらないときは、これまで通り「購入する」ボタンが出ます（`STORE_FORCE_SOLD_OUT` だけは常に効きます）。

## 解約ボタン（お客さんが自分で解約できるようにする）

> **なぜAPI（サーバー）を使っていないか**
> Stripeのカスタマーポータルを開く方法は2つあります。
> 1. サーバーで `stripe.billingPortal.sessions.create()` を呼んでURLを都度発行する（要: サーバー・会員ログイン・DB）
> 2. ダッシュボードで発行する固定の「ポータルリンク」を貼る（サーバー不要）
>
> このサイトは GitHub Pages の静的サイトで、サーバーもログイン機能もDBもないため **2** を使っています。
> 1 は「アクセスしているのが誰か」をサーバーが知っている前提の方法なので、ログイン機能がないと使えません。
> お客さんが見る解約画面はどちらも同じで、2 では代わりにStripeがメールで本人確認をします。
>
> なお、シークレットキー（`sk_live_...`）は絶対に `index.html` に書かないでください。
> 静的サイトのファイルは誰でも中身を見られるため、Stripeアカウントを乗っ取られます。


`https://b-core.space/#cancel` に「解約のお手続き」ページがあります（フッター・JOINページ・特商法ページからリンク）。
ボタンの飛び先は **Stripeのカスタマーポータル**です。お客さんは

1. ボタンを押す → Stripeのお客様ページが開く
2. 申し込み時のメールアドレスを入力
3. 届いたメールのリンク（確認コード）でログイン
4. 「プランをキャンセル」を押す

の4ステップで自分で解約できます。**こちら側の手作業は不要**です（解約されるとStripeからメールが届きます）。

### 1. Stripeでカスタマーポータルを有効にする

https://dashboard.stripe.com → 「設定」→「請求」→「カスタマーポータル」

| 項目 | 設定 |
| --- | --- |
| サブスクリプションのキャンセル | **オン**（これが解約ボタンの本体） |
| キャンセルのタイミング | **必ず「請求期間の終了時」**（払った分は末日まで使える＝サイトの表記と一致） |
| プランの変更 | 必要なら ON（ONLINE ⇄ OFFLINE の乗り換えができます） |
| お支払い方法の更新 | オン（カード期限切れの自己解決用） |
| 請求書の履歴 | オン |

ページ下部の **「ログインリンクを共有する」をオン**にすると、`https://billing.stripe.com/p/login/...` が発行されます。これをコピーします。

### 2. サイトに貼る

`index.html` の `<script>` 冒頭、`STRIPE_LINKS` のすぐ下です。

```js
const STRIPE_PORTAL      = 'https://billing.stripe.com/p/login/xxxxxxxx';       // 本番
const STRIPE_TEST_PORTAL = 'https://billing.stripe.com/p/login/test_xxxxxxxx';  // テスト
```

支払いリンクと同じルールで切り替わります。

| 開くURL | 使われるリンク |
| --- | --- |
| https://b-core.space/#cancel （通常） | `STRIPE_PORTAL`（本番） |
| https://b-core.space/?test=1#cancel | `STRIPE_TEST_PORTAL`（テスト） |

> 注意: `?test=1` は必ず `#cancel` より**前**に付けてください（`#cancel?test=1` の順だとテストモードになりません）。
| ローカル表示 | `STRIPE_TEST_PORTAL`（テスト） |

空のままの場合、ボタンを押すと「メールまたはInstagramのDMからご連絡ください」という案内が出るだけで、誤って壊れたページに飛ぶことはありません。

### 3. 現在の解約ルール

サイトに記載しているのは次の内容です。

| 項目 | 内容 |
| --- | --- |
| 解約のタイミング | **いつでも**。締め日・事前連絡なし。手続きをした時点で次回以降の自動更新が停止 |
| 解約後のご利用 | お支払い済みの期間の**末日まで利用できる**（すぐに止まらない） |
| 返金 | なし。日割り返金もなし |

変えるときは `index.html` の **2箇所を必ず揃えて**ください（食い違うと特商法上の表示として問題になります）。

- `#page-cancel` の「解約のタイミング」「解約後のご利用」とリード文
- `#page-legal` の「解約について」「返品・返金について」

> 注意: Stripeの「キャンセルのタイミング」設定と、サイトに書いた解約ルールは必ず一致させてください。
> サイトには「末日まで利用できます」と書いてあるので、Stripe側は「**請求期間の終了時**にキャンセル」にします。
> Stripe側を「即時キャンセル」にすると、払った分が残っていてもその場で使えなくなり、表示と食い違います。
