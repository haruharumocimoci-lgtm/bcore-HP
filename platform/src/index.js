/**
 * B-CORE 会員基盤 — Stripe Webhook 受信 Worker
 * ---------------------------------------------------------------
 * StripeからのWebhook通知を受け取り、D1（会員データベース）を更新します。
 * これにより「このメールアドレスの人は、いま有効な会員か」が判定できるようになり、
 * 講義プラットフォームの入室チェックに使えます。
 *
 * エンドポイント:
 *   POST /stripe/webhook     … Stripeからの通知を受ける（Stripeダッシュボードに登録するURL）
 *   POST /api/members/check  … 講義プラットフォームからの入室チェック（APIキーが必要）
 *   GET  /health             … 動作確認用
 *
 * 必要なシークレット（Cloudflareの「変数とシークレット」で設定）:
 *   STRIPE_WEBHOOK_SECRET      … whsec_xxx（本番モードのWebhook登録時にStripeが発行）
 *   STRIPE_WEBHOOK_SECRET_TEST … whsec_xxx（テストモード用。任意）
 *   STRIPE_SECRET_KEY          … sk_live_xxx（顧客のメール取得用。任意だが推奨）
 *   STRIPE_SECRET_KEY_TEST     … sk_test_xxx（テストモード用。任意）
 *   MEMBER_API_KEY             … 入室チェックAPIの合言葉（未設定ならAPIは閉じたまま）
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
    if (url.pathname === '/api/members/check') {
      if (request.method === 'OPTIONS') return corsPreflight();
      if (request.method === 'POST' || request.method === 'GET') {
        return handleMemberCheck(request, env, url);
      }
      return jsonResponse({ error: 'method not allowed' }, 405);
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      // 合言葉が実行環境から見えているかを true/false で示す（値そのものは出さない）
      return jsonResponse({
        ok: true,
        secrets: {
          live: Boolean(await readSecret(env, 'STRIPE_WEBHOOK_SECRET')),
          test: Boolean(await readSecret(env, 'STRIPE_WEBHOOK_SECRET_TEST')),
          memberApi: Boolean(await readSecret(env, 'MEMBER_API_KEY')),
        },
      });
    }
    return new Response('Not found', { status: 404 });
  },
};

/**
 * シークレットを読み出す。
 * Cloudflareでの設定方法によって、届く形が2通りあるため両方に対応する。
 *   ・「変数とシークレット」で登録 → 文字列としてそのまま入る
 *   ・「Secrets Store」をバインド   → .get() で取り出すオブジェクトが入る
 */
async function readSecret(env, name) {
  const value = env[name];
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value.get === 'function') {
    try {
      return String(await value.get()).trim();
    } catch (err) {
      console.error(`Secrets Storeから ${name} を読めませんでした:`, err?.message || err);
      return '';
    }
  }
  return '';
}

/* =========================================================
   Webhook 本体
   ========================================================= */

async function handleStripeWebhook(request, env) {
  // 貼り付け時に前後の空白や改行が混ざることがあるので取り除く
  const secrets = [
    { mode: 'live', value: await readSecret(env, 'STRIPE_WEBHOOK_SECRET') },
    { mode: 'test', value: await readSecret(env, 'STRIPE_WEBHOOK_SECRET_TEST') },
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
  const plan = await resolvePlan(priceId, env, ctx);
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
    sub.id, customerId, email, plan, priceId, status, periodEnd,
    sub.cancel_at_period_end ? 1 : 0, ctx.isTest ? 1 : 0, now, now
  ).run();
}

/**
 * 契約が ONLINE / OFFLINE のどちらのプランかを判別する。
 *   1. wrangler.toml の [vars] に price_id を書いてあれば、それと照合する（いちばん確実）
 *   2. 書いていなければ、Stripeに商品名を問い合わせて名前から判別する
 * どちらもできなければ null（プラン欄が空になるだけで、会員判定そのものは動く）。
 */
async function resolvePlan(priceId, env, ctx = {}) {
  if (!priceId) return null;

  const configured = matchConfiguredPrice(priceId, env, ctx);
  if (configured) return configured;

  // テストモードの契約にはテスト用のキーを使う（本番キーでは引けない）
  const apiKey = await readSecret(env, ctx.isTest ? 'STRIPE_SECRET_KEY_TEST' : 'STRIPE_SECRET_KEY');
  if (!apiKey) return null;

  // プラン名は「あれば嬉しい」情報なので、取得に失敗しても契約の記録は止めない
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}?expand[]=product`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!res.ok) {
      console.error(`Stripeから料金を取得できませんでした ${priceId}: ${res.status}`);
      return null;
    }
    const price = await res.json();
    return planFromLabel(`${price.nickname || ''} ${price.lookup_key || ''} ${price.product?.name || ''}`);
  } catch (err) {
    console.error(`Stripeへの料金の問い合わせに失敗 ${priceId}:`, err?.message || err);
    return null;
  }
}

// wrangler.toml に書いた price_id と照合する。本番とテストで price_id は別物
function matchConfiguredPrice(priceId, env, ctx = {}) {
  const online = (ctx.isTest ? env.PRICE_ONLINE_TEST : env.PRICE_ONLINE) || '';
  const offline = (ctx.isTest ? env.PRICE_OFFLINE_TEST : env.PRICE_OFFLINE) || '';
  if (online && priceId === online) return 'online';
  if (offline && priceId === offline) return 'offline';
  return null;
}

// 商品名（「B-CORE ONLINE」など）からプランを読み取る
function planFromLabel(text) {
  const label = String(text).toLowerCase();
  if (label.includes('offline') || label.includes('オフライン')) return 'offline';
  if (label.includes('online') || label.includes('オンライン')) return 'online';
  return null;
}

// customer_id からメールアドレスを引く。DBになければStripeに問い合わせる
async function resolveEmail(env, customerId, ctx = {}) {
  const row = await env.DB.prepare('SELECT email FROM customers WHERE id = ?')
    .bind(customerId).first();
  if (row?.email) return row.email;

  // テストモードのイベントにはテスト用のキーを使う（本番キーでは引けない）
  const apiKey = await readSecret(env, ctx.isTest ? 'STRIPE_SECRET_KEY_TEST' : 'STRIPE_SECRET_KEY');
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
   入室チェックAPI（講義プラットフォームから呼ぶ）
   ---------------------------------------------------------
   「このメールアドレスの人は、いま有効な会員か？」に答えます。
   会員かどうかを他人に勝手に調べられないよう、必ずAPIキーで保護します。

     POST https://bcore-hp.haruharumocimoci.workers.dev/api/members/check
     Authorization: Bearer <MEMBER_API_KEY>
     {"email": "parent@example.com"}

     → {"member": true, "plan": "online", "status": "active",
        "current_period_end": 1790000000, "cancel_at_period_end": false}
     → {"member": false}

   解約しても期間の末日までは status が active のままなので、
   HPに書いた「お支払い済みの期間の末日までご利用いただけます」と自動で一致します。
   ========================================================= */

// 会員とみなす契約の状態。past_due（支払い失敗）は含めない
const ACTIVE_STATUSES = ['active', 'trialing'];

async function handleMemberCheck(request, env, url) {
  const apiKey = await readSecret(env, 'MEMBER_API_KEY');
  if (!apiKey) {
    // 合言葉を決めるまでAPIは閉じたままにする（誤って誰でも引ける状態にしない）
    console.error('MEMBER_API_KEY が未設定のため入室チェックAPIは使えません');
    return jsonResponse({ error: 'not configured' }, 503);
  }

  if (!timingSafeEqual(presentedApiKey(request), apiKey)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  // POSTならJSONの本文、GETなら ?email= から受け取る
  let input = {};
  if (request.method === 'POST') {
    try {
      input = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid json' }, 400);
    }
    if (!input || typeof input !== 'object') return jsonResponse({ error: 'invalid json' }, 400);
  } else {
    input = { email: url.searchParams.get('email'), test: url.searchParams.get('test') };
  }

  const email = normalizeEmail(input.email);
  if (!email) return jsonResponse({ error: 'email is required' }, 400);

  // テストモードのデータを引きたいときだけ test:true を付ける（既定は本番の会員のみ）
  const isTest = input.test === true || input.test === 1 || input.test === '1' || input.test === 'true';

  const row = await env.DB.prepare(`
    SELECT plan, status, current_period_end, cancel_at_period_end
    FROM subscriptions
    WHERE email = ? AND is_test = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})
    ORDER BY COALESCE(current_period_end, 0) DESC
    LIMIT 1
  `).bind(email, isTest ? 1 : 0, ...ACTIVE_STATUSES).first();

  if (!row) return jsonResponse({ member: false });

  return jsonResponse({
    member: true,
    plan: row.plan || null,
    status: row.status,
    current_period_end: row.current_period_end ?? null,
    cancel_at_period_end: Boolean(row.cancel_at_period_end),
  });
}

// 合言葉は Authorization: Bearer xxx か x-api-key ヘッダーで受け取る
// （URLに書くとアクセスログに残ってしまうため、クエリ文字列では受け取らない）
function presentedApiKey(request) {
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  return (request.headers.get('x-api-key') || '').trim();
}

function corsPreflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, x-api-key',
    'access-control-max-age': '86400',
  };
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
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}
