/**
 * B-CORE 会員基盤 — Stripe Webhook 受信 Worker
 * ---------------------------------------------------------------
 * StripeからのWebhook通知を受け取り、D1（会員データベース）を更新します。
 * これにより「このメールアドレスの人は、いま有効な会員か」が判定できるようになり、
 * 講義プラットフォームの入室チェックに使えます。
 *
 * エンドポイント:
 *   POST /stripe/webhook  … Stripeからの通知を受ける（Stripeダッシュボードに登録するURL）
 *   GET  /health          … 動作確認用
 *
 * 必要なシークレット（Cloudflareの「変数とシークレット」で設定）:
 *   STRIPE_WEBHOOK_SECRET      … whsec_xxx（本番モードのWebhook登録時にStripeが発行）
 *   STRIPE_WEBHOOK_SECRET_TEST … whsec_xxx（テストモード用。任意）
 *   STRIPE_SECRET_KEY          … sk_live_xxx（顧客のメール取得用。任意だが推奨）
 *   STRIPE_SECRET_KEY_TEST     … sk_test_xxx（テストモード用。任意）
 *
 * 本番とテストのどちらの合言葉でも受け付けます（署名が合った方を採用）。
 * テストモードのイベントは livemode:false で届くので、
 * データベースには is_test = 1 を付けて本番の会員と区別します。
 */

const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/stripe/webhook') {
      return handleStripeWebhook(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ ok: true });
    }
    return new Response('Not found', { status: 404 });
  },
};

/* =========================================================
   Webhook 本体
   ========================================================= */

async function handleStripeWebhook(request, env) {
  // 貼り付け時に前後の空白や改行が混ざることがあるので取り除く
  const secrets = [
    { mode: 'live', value: (env.STRIPE_WEBHOOK_SECRET || '').trim() },
    { mode: 'test', value: (env.STRIPE_WEBHOOK_SECRET_TEST || '').trim() },
  ].filter(s => s.value);

  if (secrets.length === 0) {
    console.error('STRIPE_WEBHOOK_SECRET も STRIPE_WEBHOOK_SECRET_TEST も未設定です');
    return jsonResponse({ error: 'not configured' }, 500);
  }

  // 署名検証には「加工前の生データ」が必要なので、必ず text() で読む
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature') || '';

  // 本番・テストのどちらの合言葉で署名されたものかを判定する
  let matched = null;
  for (const secret of secrets) {
    if (await verifyStripeSignature(payload, signature, secret.value)) {
      matched = secret;
      break;
    }
  }

  if (!matched) {
    // 署名が合わない = Stripe以外からの偽の通知。処理せず拒否する
    // 原因の切り分け用。鍵の値は一切出さず、形が正しいかだけ記録する
    console.error(
      `署名が一致しません。試した鍵=${secrets.map(s => `${s.mode}(長さ${s.value.length},whsec_=${s.value.startsWith('whsec_')})`).join(' ')} ` +
      `署名ヘッダー=${signature ? 'あり' : 'なし'}`
    );
    return jsonResponse({ error: 'invalid signature' }, 400);
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400);
  }
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
    return jsonResponse({ error: 'invalid event' }, 400);
  }

  // 同じイベントが再送されても二重処理しない
  const first = await env.DB.prepare(
    'INSERT OR IGNORE INTO webhook_events (id, type, is_test, received_at) VALUES (?, ?, ?, ?)'
  ).bind(event.id, event.type, event.livemode === false ? 1 : 0, nowSec()).run();

  if (!first.meta?.changes) {
    return jsonResponse({ received: true, duplicate: true });
  }

  try {
    await dispatch(event, env, { isTest: event.livemode === false, mode: matched.mode });
  } catch (err) {
    // 失敗したイベントは記録を消し、Stripeに再送させる
    await env.DB.prepare('DELETE FROM webhook_events WHERE id = ?').bind(event.id).run();
    console.error(`イベント処理に失敗 ${event.type} (${event.id}):`, err?.stack || err);
    return jsonResponse({ error: 'processing failed' }, 500);
  }

  return jsonResponse({ received: true });
}

async function dispatch(event, env, ctx) {
  const object = event.data?.object || {};

  switch (event.type) {
    // 決済完了。ここで初めてメールアドレスが分かる
    case 'checkout.session.completed': {
      const customerId = asId(object.customer);
      const email = object.customer_details?.email || object.customer_email;
      if (customerId) {
        await upsertCustomer(env, customerId, email, object.customer_details?.name, ctx);
        if (email) await backfillEmail(env, customerId, email);
      }
      return;
    }

    case 'customer.created':
    case 'customer.updated': {
      if (object.id) {
        await upsertCustomer(env, object.id, object.email, object.name, ctx);
        if (object.email) await backfillEmail(env, object.id, normalizeEmail(object.email));
      }
      return;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      await upsertSubscription(event, env, ctx);
      return;
    }

    default:
      // 未対応のイベントは無視（Stripeには200を返す）
      return;
  }
}

/* =========================================================
   データベース更新
   ========================================================= */

async function upsertCustomer(env, customerId, email, name, ctx = {}) {
  const now = nowSec();
  await env.DB.prepare(`
    INSERT INTO customers (id, email, name, is_test, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email      = COALESCE(excluded.email, customers.email),
      name       = COALESCE(excluded.name,  customers.name),
      is_test    = excluded.is_test,
      updated_at = excluded.updated_at
  `).bind(customerId, normalizeEmail(email), name || null, ctx.isTest ? 1 : 0, now, now).run();
}

// 顧客のメールアドレスが後から判明したとき、契約テーブル側にも反映する
async function backfillEmail(env, customerId, email) {
  if (!email) return;
  await env.DB.prepare(
    'UPDATE subscriptions SET email = ?, updated_at = ? WHERE customer_id = ? AND (email IS NULL OR email <> ?)'
  ).bind(email, nowSec(), customerId, email).run();
}

async function upsertSubscription(event, env, ctx = {}) {
  const sub = event.data.object;
  const customerId = asId(sub.customer);
  if (!sub.id || !customerId) throw new Error('subscription に id / customer がありません');

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id || null;

  // Stripeの新しいAPIバージョンでは請求期間が items 側に移動している
  const periodEnd = sub.current_period_end ?? item?.current_period_end ?? null;

  // 解約イベントのときは status が active のまま届くことがあるため上書きする
  const status = event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status;

  const email = await resolveEmail(env, customerId, ctx);
  const now = nowSec();

  await env.DB.prepare(`
    INSERT INTO subscriptions
      (id, customer_id, email, plan, price_id, status, current_period_end,
       cancel_at_period_end, is_test, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer_id          = excluded.customer_id,
      email                = COALESCE(excluded.email, subscriptions.email),
      plan                 = COALESCE(excluded.plan,  subscriptions.plan),
      price_id             = COALESCE(excluded.price_id, subscriptions.price_id),
      status               = excluded.status,
      current_period_end   = COALESCE(excluded.current_period_end, subscriptions.current_period_end),
      cancel_at_period_end = excluded.cancel_at_period_end,
      is_test              = excluded.is_test,
      updated_at           = excluded.updated_at
  `).bind(
    sub.id, customerId, email, planFromPrice(priceId, env), priceId, status, periodEnd,
    sub.cancel_at_period_end ? 1 : 0, ctx.isTest ? 1 : 0, now, now
  ).run();
}

// 支払いリンクのprice_idからプラン名を決める（環境変数で対応付け）
function planFromPrice(priceId, env) {
  if (!priceId) return null;
  if (env.PRICE_ONLINE && priceId === env.PRICE_ONLINE) return 'online';
  if (env.PRICE_OFFLINE && priceId === env.PRICE_OFFLINE) return 'offline';
  return null;
}

// customer_id からメールアドレスを引く。DBになければStripeに問い合わせる
async function resolveEmail(env, customerId, ctx = {}) {
  const row = await env.DB.prepare('SELECT email FROM customers WHERE id = ?')
    .bind(customerId).first();
  if (row?.email) return row.email;

  // テストモードのイベントにはテスト用のキーを使う（本番キーでは引けない）
  const apiKey = ((ctx.isTest ? env.STRIPE_SECRET_KEY_TEST : env.STRIPE_SECRET_KEY) || '').trim();
  if (!apiKey) return null;

  const res = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error(`Stripeから顧客を取得できませんでした ${customerId}: ${res.status}`);
    return null;
  }
  const customer = await res.json();
  const email = normalizeEmail(customer.email);
  if (email) await upsertCustomer(env, customerId, email, customer.name, ctx);
  return email;
}

/* =========================================================
   Stripe署名の検証
   （Stripe-Signature ヘッダー: t=タイムスタンプ,v1=署名）
   ========================================================= */

async function verifyStripeSignature(payload, header, secret, toleranceSec = 300) {
  if (!header) return false;

  let timestamp = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  // 古い通知の使い回し（リプレイ攻撃）を防ぐ
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSec() - ts) > toleranceSec) return false;

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
  const expected = toHex(new Uint8Array(mac));

  return signatures.some(sig => timingSafeEqual(sig, expected));
}

// 文字列の比較にかかる時間から署名を推測されないようにする
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* =========================================================
   小さな道具
   ========================================================= */

function toHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// Stripeは customer を文字列で返すことも、展開したオブジェクトで返すこともある
function asId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.id === 'string') return value.id;
  return null;
}

function normalizeEmail(email) {
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
