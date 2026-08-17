// index.html（配信用の完全なHTML文書）から、Claude Artifact 公開用のファイルを生成する。
// Artifact 側は <!doctype>/<html>/<head>/<body> を自前で付けるため、
// <title> + <style> + body の中身だけを取り出して dist/artifact.html に書き出す。
//
//   node scripts/build-artifact.mjs
//
// 生成物は dist/artifact.html。これを Artifact ツールで公開する。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = await readFile(join(root, 'index.html'), 'utf8');

const pick = (re, label) => {
  const m = src.match(re);
  if (!m) throw new Error(`index.html に ${label} が見つかりません`);
  return m[0];
};

const title = pick(/<title>[\s\S]*?<\/title>/i, '<title>');
const styles = [...src.matchAll(/<style>[\s\S]*?<\/style>/gi)].map((m) => m[0]);
if (styles.length === 0) throw new Error('index.html に <style> が見つかりません');

const bodyMatch = src.match(/<body[^>]*>([\s\S]*)<\/body>/i);
if (!bodyMatch) throw new Error('index.html に <body> が見つかりません');

const out = [title, ...styles, bodyMatch[1].trim(), ''].join('\n');

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist', 'artifact.html'), out, 'utf8');

console.log(`dist/artifact.html を生成しました（${out.length} 文字）`);
