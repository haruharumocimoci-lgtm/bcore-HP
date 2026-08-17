# B-CORE 公式HP

野球塾 B-CORE の公式ホームページ。ビルド不要の静的サイトで、`index.html` 1枚に完結しています（外部CDN・依存パッケージなし）。

## 公開リンク

- **一般公開URL（GitHub Pages）: https://haruharumocimoci-lgtm.github.io/bcore-HP/**
  誰でもログインなしで見られます。お客さん・保護者へはこちらを共有してください。
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

- 入会申し込みフォームのURL（`#joinBtn` の `href`）
- InstagramアカウントのURL（`.footer__sns` の `href`）
- STOREとCOACHの写真（現在はプレースホルダー表示）
