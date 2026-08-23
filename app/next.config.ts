import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // Cloudflare Workers では Next.js の画像最適化サーバーを使わない
  images: { unoptimized: true },
};

export default nextConfig;

// ローカル開発時（next dev）でも wrangler のバインディング（D1など）を使えるようにする
initOpenNextCloudflareForDev();
