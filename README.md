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

- Stripeの支払いリンクURL（`index.html` 冒頭の `STRIPE_LINKS`）→ 下記「Stripeで決済を受け取る」参照
- 問い合わせメールアドレス（会社用アドレス作成後に差し替え。`index.html` 内に3箇所: 特商法ページ・プライバシーポリシー・フッター）
- STOREとCOACHの写真（現在はプレースホルダー表示）

## 規約ページ

Stripeの審査と継続課金のため、次の2ページを `index.html` 内に持っています（フッターからリンク）。

| ハッシュURL | 内容 |
| --- | --- |
| `https://b-core.space/#legal` | 特定商取引法に基づく表記 |
| `https://b-core.space/#privacy` | プライバシーポリシー |

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

### 4. 本番の前に

- 最初は**テストモード**のリンクで動作確認（テストカード `4242 4242 4242 4242`）
- 入金を受け取るには Stripeダッシュボードで**本人確認と銀行口座の登録**が必要です
- 本番モードに切り替えたら、リンクを本番用のURLに貼り替えてください

> 手数料の目安: 国内カード決済 3.6%（例: 5,500円 → 約199円）。サーバー代・月額固定費はかかりません。
