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
 *   GET  /stock           … 在庫の残数（HPのSTOREページが読んで SOLD OUT を出す）
 *
 * 在庫管理（スパサブ）:
 *   決済完了 → 在庫を減らす／全額返金 → 在庫を戻す／0になったら支払いリンクを無効化。
 *   商品の見分け方は wrangler.toml の PRICE_SPASUB / PAYMENT_LINK_SPASUB。
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
    if (request.method === 'GET' && url.pathname === '/stock') {
      return handleStock(url, env);
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      // 合言葉が実行環境から見えているかを true/false で示す（値そのものは出さない）
      // prices は wrangler.toml の [vars] が反映されているかの確認用。
      // 両方 false なら、価格IDを書き換えた後のデプロイがまだ届いていない。
      return jsonResponse({
        ok: true,
        secrets: {
          live: Boolean(await readSecret(env, 'STRIPE_WEBHOOK_SECRET')),
          test: Boolean(await readSecret(env, 'STRIPE_WEBHOOK_SECRET_TEST')),
        },
        prices: {
          online: Boolean(env.PRICE_ONLINE),
          offline: Boolean(env.PRICE_OFFLINE),
          spasub: Boolean(env.PRICE_SPASUB),
        },
        // 在庫管理の設定確認用。apiKey が false だと明細（個数）を取れず、1個として数える
        stock: {
          apiKey: {
            live: Boolean(await readSecret(env, 'STRIPE_SECRET_KEY')),
            test: Boolean(await readSecret(env, 'STRIPE_SECRET_KEY_TEST')),
          },
          paymentLink: Boolean(env.PAYMENT_LINK_SPASUB),
          stripeApi: stripeApiBase(env),
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
      // 都度購入（スパサブ）なら在庫を減らす
      await recordPurchase(object, env, ctx);
      return;
    }

    // 返金。全額返金なら在庫を戻す
    case 'charge.refunded': {
      await restoreStock(object, env, ctx);
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
  const apiKey = await readSecret(env, ctx.isTest ? 'STRIPE_SECRET_KEY_TEST' : 'STRIPE_SECRET_KEY');
  if (!apiKey) return null;

  const customer = await stripeGet(env, apiKey, `/v1/customers/${encodeURIComponent(customerId)}`);
  if (!customer) {
    console.error(`Stripeから顧客を取得できませんでした ${customerId}`);
    return null;
  }
  const email = normalizeEmail(customer.email);
  if (email) await upsertCustomer(env, customerId, email, customer.name, ctx);
  return email;
}

/* =========================================================
   在庫管理（スパサブなど、都度購入の商品）
   ---------------------------------------------------------
   ・決済完了（checkout.session.completed）で在庫を減らす
   ・全額返金（charge.refunded）で在庫を戻す（一部返金は動かさない）
   ・在庫が0になったら Stripe の支払いリンクを無効化する（直接URLからの購入も止める）
   ・GET /stock で残数を返す（HPのSTOREページが読む）
   本番とテストモードの在庫は別々に数える（inventory.is_test）。
   ========================================================= */

// 在庫を数える商品。増やすときはここと wrangler.toml の [vars]、schema.sql の初期在庫に追加する
const STOCK_PRODUCTS = {
  spasub: { priceVar: 'PRICE_SPASUB', linkVar: 'PAYMENT_LINK_SPASUB' },
};

async function handleStock(url, env) {
  const isTest = url.searchParams.get('test') === '1' ? 1 : 0;
  const { results } = await env.DB.prepare(
    'SELECT product, stock, updated_at FROM inventory WHERE is_test = ?'
  ).bind(isTest).all();

  const products = {};
  for (const row of results || []) {
    products[row.product] = { stock: row.stock, soldOut: row.stock <= 0, updatedAt: row.updated_at };
  }
  // HP（b-core.space）は別ドメインなので、どこからでも読めるようにする。数字を返すだけなので公開して問題ない
  return jsonResponse({ ok: true, test: isTest === 1, products }, 200, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
}

// 決済完了の通知から、在庫対象の商品を見つけて在庫を減らす
async function recordPurchase(session, env, ctx = {}) {
  // サブスク（ONLINE / OFFLINE）は在庫と無関係。都度購入（mode: payment）だけを見る
  if (session.mode !== 'payment' || typeof session.id !== 'string') return;

  const items = await purchasedItems(session, env, ctx);
  if (items.length === 0) return;

  const isTest = ctx.isTest ? 1 : 0;
  const email = normalizeEmail(session.customer_details?.email || session.customer_email);
  const paymentIntent = asId(session.payment_intent);

  for (const { product, quantity } of items) {
    // 同じ決済を二重に数えない（通知の再送や、処理失敗後のリトライ対策）
    const orderId = `${session.id}:${product}`;
    const exists = await env.DB.prepare('SELECT 1 FROM orders WHERE id = ?').bind(orderId).first();
    if (exists) continue;

    const now = nowSec();
    // 注文の記録と在庫の減算を1つのトランザクションで行う（片方だけ成功、を防ぐ）
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO orders (id, product, quantity, email, payment_intent, status, is_test, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'paid', ?, ?, ?)
      `).bind(orderId, product, quantity, email, paymentIntent, isTest, now, now),
      // 在庫の行がまだ無ければ 0 として作る。マイナスにはしない
      env.DB.prepare(`
        INSERT INTO inventory (product, is_test, stock, updated_at) VALUES (?, ?, 0, ?)
        ON CONFLICT(product, is_test) DO UPDATE SET
          stock      = MAX(inventory.stock - ?, 0),
          updated_at = excluded.updated_at
      `).bind(product, isTest, now, quantity),
    ]);

    const stock = await getStock(env, product, isTest);
    console.log(`在庫 ${product}: -${quantity} → 残り ${stock}${isTest ? '（テスト）' : ''}`);
    if (stock === 0) await closePaymentLink(env, product, ctx);
  }
}

// 決済に含まれる在庫対象の商品と個数を返す。例: [{ product: 'spasub', quantity: 2 }]
async function purchasedItems(session, env, ctx) {
  const apiKey = await readSecret(env, ctx.isTest ? 'STRIPE_SECRET_KEY_TEST' : 'STRIPE_SECRET_KEY');

  // 本命: Stripeに明細（line_items）を問い合わせ、料金ID（price_xxx）で商品を見分けて個数を合計する
  if (apiKey) {
    const lines = await stripeGet(env, apiKey,
      `/v1/checkout/sessions/${encodeURIComponent(session.id)}/line_items?limit=100`);
    const totals = {};
    for (const line of lines?.data || []) {
      const product = productFromPrice(line.price?.id, env);
      if (product) totals[product] = (totals[product] || 0) + (Number(line.quantity) || 1);
    }
    const found = Object.entries(totals).map(([product, quantity]) => ({ product, quantity }));
    if (found.length > 0) return found;
  }

  // 予備: 支払いリンクのID（plink_xxx）で見分ける。個数は分からないので1個として数える
  const product = productFromLink(asId(session.payment_link), env, ctx);
  if (!product) return [];
  console.warn(
    `明細から商品を特定できなかったため、支払いリンクのIDから ${product} を1個として数えました（${session.id}）。` +
    'まとめ買いだった場合は在庫を手で直してください（README「在庫管理」参照）'
  );
  return [{ product, quantity: 1 }];
}

// 全額返金されたら、その注文の分だけ在庫を戻す
async function restoreStock(charge, env, ctx = {}) {
  // refunded が true のときだけが全額返金。一部返金では在庫を動かさない
  if (charge.refunded !== true) return;
  const paymentIntent = asId(charge.payment_intent);
  if (!paymentIntent) return;

  const isTest = ctx.isTest ? 1 : 0;
  const { results } = await env.DB.prepare(
    "SELECT id, product, quantity FROM orders WHERE payment_intent = ? AND status = 'paid' AND is_test = ?"
  ).bind(paymentIntent, isTest).all();

  for (const order of results || []) {
    const now = nowSec();
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET status = 'refunded', updated_at = ? WHERE id = ? AND status = 'paid'")
        .bind(now, order.id),
      env.DB.prepare('UPDATE inventory SET stock = stock + ?, updated_at = ? WHERE product = ? AND is_test = ?')
        .bind(order.quantity, now, order.product, isTest),
    ]);
    console.log(`返金により在庫を戻しました ${order.product}: +${order.quantity}${isTest ? '（テスト）' : ''}`);
  }
}

async function getStock(env, product, isTest) {
  const row = await env.DB.prepare('SELECT stock FROM inventory WHERE product = ? AND is_test = ?')
    .bind(product, isTest).first();
  return row ? row.stock : null;
}

// 在庫が0になったら、Stripeの支払いリンクを無効化する（HPを経由しない直接URLからの購入も止める）
// 再入荷したときは Stripeダッシュボードで手動で有効に戻す
async function closePaymentLink(env, product, ctx) {
  const linkId = paymentLinkId(env, product, ctx);
  const apiKey = await readSecret(env, ctx.isTest ? 'STRIPE_SECRET_KEY_TEST' : 'STRIPE_SECRET_KEY');
  if (!linkId || !apiKey) return;

  // ここで失敗しても注文と在庫は記録済みなので、Stripeに再送させず記録だけ残す
  try {
    const res = await fetch(`${stripeApiBase(env)}/v1/payment_links/${encodeURIComponent(linkId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'active=false',
    });
    if (res.ok) console.log(`売り切れのため支払いリンク ${linkId} を無効化しました（${product}）`);
    else console.error(`支払いリンク ${linkId} を無効化できませんでした: ${res.status}`);
  } catch (err) {
    console.error(`支払いリンク ${linkId} を無効化できませんでした:`, err?.message || err);
  }
}

// 料金ID（price_xxx）→ 商品名。wrangler.toml の [vars] で対応付ける
function productFromPrice(priceId, env) {
  if (!priceId) return null;
  for (const [product, cfg] of Object.entries(STOCK_PRODUCTS)) {
    if (env[cfg.priceVar] && priceId === env[cfg.priceVar]) return product;
  }
  return null;
}

// 支払いリンクID（plink_xxx）→ 商品名
function productFromLink(linkId, env, ctx) {
  if (!linkId) return null;
  for (const product of Object.keys(STOCK_PRODUCTS)) {
    if (linkId === paymentLinkId(env, product, ctx)) return product;
  }
  return null;
}

// 本番とテストモードで支払いリンクは別物。テスト用は PAYMENT_LINK_xxx_TEST（任意）
function paymentLinkId(env, product, ctx = {}) {
  const name = STOCK_PRODUCTS[product]?.linkVar;
  if (!name) return null;
  const value = ctx.isTest ? env[`${name}_TEST`] : env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/* =========================================================
   Stripe API（読み取り）
   ========================================================= */

// 通常は api.stripe.com。ローカルのテストで偽のAPIに向けるときだけ STRIPE_API_BASE を使う
function stripeApiBase(env) {
  const base = typeof env.STRIPE_API_BASE === 'string' ? env.STRIPE_API_BASE.trim() : '';
  return (base || 'https://api.stripe.com').replace(/\/+$/, '');
}

// 失敗したら null（呼び出し側で予備の判定に進む）。ネットワーク断は例外のまま上げてStripeに再送させる
async function stripeGet(env, apiKey, path) {
  const res = await fetch(`${stripeApiBase(env)}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    console.error(`Stripe API の呼び出しに失敗 ${path.split('?')[0]}: ${res.status}`);
    return null;
  }
  return res.json();
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

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}
