/**
 * 入室チェックAPIのテスト
 * `npx wrangler dev` を起動した状態で `npm test` を実行します。
 *
 * 講義プラットフォームから「この人は有効な会員か」を問い合わせる部分の確認です。
 */
import { createHmac } from 'node:crypto';

const BASE = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
const SECRET_TEST = process.env.STRIPE_WEBHOOK_SECRET_TEST || 'whsec_testmode_secret';
const API_KEY = process.env.MEMBER_API_KEY || 'test_member_api_key';

// 何度実行しても前回のデータとぶつからないよう、実行ごとに違う名前を使う
const RUN = Date.now().toString(36);

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

function sign(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const mac = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

// テスト用の会員データを、実際のWebhookと同じ道すじで作る
async function seed(event, livemode = true) {
  const body = JSON.stringify({ ...event, livemode });
  const res = await fetch(`${BASE}/stripe/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': sign(body, livemode ? SECRET : SECRET_TEST),
    },
    body,
  });
  if (res.status !== 200) throw new Error(`データ準備に失敗: ${res.status}`);
}

const subscription = (id, customer, priceId, extra = {}) => ({
  id, customer, status: 'active', cancel_at_period_end: false,
  items: { data: [{ price: { id: priceId }, current_period_end: 1790000000 }] },
  ...extra,
});

async function checkMember(email, { key = API_KEY, header = 'authorization', ...rest } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (key !== null) {
    headers[header] = header === 'authorization' ? `Bearer ${key}` : key;
  }
  const res = await fetch(`${BASE}/api/members/check`, {
    method: 'POST', headers, body: JSON.stringify({ email, ...rest }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/* ---------- テスト用の会員を用意する ---------- */

// 有効な会員（ONLINE）
await seed({ id: `evt_m1_${RUN}`, type: 'checkout.session.completed', data: { object: {
  customer: `cus_active_${RUN}`,
  customer_details: { email: `active-${RUN}@example.com`, name: '有効 会員' },
} } });
await seed({ id: `evt_m2_${RUN}`, type: 'customer.subscription.created', data: { object:
  subscription(`sub_active_${RUN}`, `cus_active_${RUN}`, 'price_online_test') } });

// 解約済みの元会員
await seed({ id: `evt_m3_${RUN}`, type: 'checkout.session.completed', data: { object: {
  customer: `cus_gone_${RUN}`,
  customer_details: { email: `gone-${RUN}@example.com`, name: '解約済み' },
} } });
await seed({ id: `evt_m4_${RUN}`, type: 'customer.subscription.deleted', data: { object:
  subscription(`sub_gone_${RUN}`, `cus_gone_${RUN}`, 'price_offline_test') } });

// 期間末での解約を予約した会員（末日まではまだ会員）
await seed({ id: `evt_m5_${RUN}`, type: 'checkout.session.completed', data: { object: {
  customer: `cus_pending_${RUN}`,
  customer_details: { email: `pending-${RUN}@example.com`, name: '解約予約' },
} } });
await seed({ id: `evt_m6_${RUN}`, type: 'customer.subscription.updated', data: { object:
  subscription(`sub_pending_${RUN}`, `cus_pending_${RUN}`, 'price_offline_test', { cancel_at_period_end: true }) } });

// 支払いに失敗している契約
await seed({ id: `evt_m7_${RUN}`, type: 'checkout.session.completed', data: { object: {
  customer: `cus_pastdue_${RUN}`,
  customer_details: { email: `pastdue-${RUN}@example.com`, name: '支払い失敗' },
} } });
await seed({ id: `evt_m8_${RUN}`, type: 'customer.subscription.updated', data: { object:
  subscription(`sub_pastdue_${RUN}`, `cus_pastdue_${RUN}`, 'price_online_test', { status: 'past_due' }) } });

// テストモードで申し込んだ人（本番の会員と混ざってはいけない）
await seed({ id: `evt_m9_${RUN}`, type: 'checkout.session.completed', data: { object: {
  customer: `cus_sandbox_${RUN}`,
  customer_details: { email: `sandbox-${RUN}@example.com`, name: 'テストモード' },
} } }, false);
await seed({ id: `evt_m10_${RUN}`, type: 'customer.subscription.created', data: { object:
  subscription(`sub_sandbox_${RUN}`, `cus_sandbox_${RUN}`, 'price_online_test') } }, false);

/* ---------- ここからテスト ---------- */

console.log('\n== APIキーの確認 ==');
{
  const r = await checkMember(`active-${RUN}@example.com`, { key: null });
  check('APIキーなしは拒否する', r.status === 401, JSON.stringify(r));
}
{
  const r = await checkMember(`active-${RUN}@example.com`, { key: 'wrong_key_value' });
  check('違うAPIキーは拒否する', r.status === 401, JSON.stringify(r));
}
{
  const r = await checkMember(`active-${RUN}@example.com`, { header: 'x-api-key' });
  check('x-api-key ヘッダーでも通る', r.status === 200, JSON.stringify(r));
}

console.log('\n== 会員かどうかの判定 ==');
{
  const r = await checkMember(`active-${RUN}@example.com`);
  check('有効な会員は member:true', r.status === 200 && r.body.member === true, JSON.stringify(r));
  check('プラン名が入る（price_idから判別）', r.body.plan === 'online', JSON.stringify(r.body));
  check('契約の状態を返す', r.body.status === 'active', JSON.stringify(r.body));
  check('期間の終わりを返す', r.body.current_period_end === 1790000000, JSON.stringify(r.body));
}
{
  const r = await checkMember(`gone-${RUN}@example.com`);
  check('解約が完了した人は member:false', r.status === 200 && r.body.member === false, JSON.stringify(r));
}
{
  const r = await checkMember(`pending-${RUN}@example.com`);
  check('期間末で解約予約中の人はまだ会員', r.body.member === true, JSON.stringify(r.body));
  check('解約予約の印が返る', r.body.cancel_at_period_end === true, JSON.stringify(r.body));
}
{
  const r = await checkMember(`pastdue-${RUN}@example.com`);
  check('支払いに失敗している人は会員としない', r.body.member === false, JSON.stringify(r.body));
}
{
  const r = await checkMember(`nobody-${RUN}@example.com`);
  check('登録のないメールアドレスは member:false', r.body.member === false, JSON.stringify(r.body));
}

console.log('\n== メールアドレスの扱い ==');
{
  const r = await checkMember(`  ACTIVE-${RUN}@Example.COM  `);
  check('大文字・前後の空白があっても同じ人として引ける', r.body.member === true, JSON.stringify(r.body));
}
{
  const r = await checkMember('');
  check('メールアドレスが空なら400', r.status === 400, JSON.stringify(r));
}
{
  const res = await fetch(`${BASE}/api/members/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: 'これはJSONではない',
  });
  check('壊れた本文は400', res.status === 400, `status=${res.status}`);
}

console.log('\n== 本番とテストモードの分離 ==');
{
  const r = await checkMember(`sandbox-${RUN}@example.com`);
  check('テストモードの申し込みは本番の会員に含めない', r.body.member === false, JSON.stringify(r.body));
}
{
  const r = await checkMember(`sandbox-${RUN}@example.com`, { test: true });
  check('test:true を付けたときだけテストモードのデータを引ける', r.body.member === true, JSON.stringify(r.body));
}
{
  const r = await checkMember(`active-${RUN}@example.com`, { test: true });
  check('本番の会員はテストモード側からは見えない', r.body.member === false, JSON.stringify(r.body));
}

console.log('\n== その他 ==');
{
  const res = await fetch(
    `${BASE}/api/members/check?email=${encodeURIComponent(`active-${RUN}@example.com`)}`,
    { headers: { authorization: `Bearer ${API_KEY}` } }
  );
  const body = await res.json().catch(() => ({}));
  check('GET でも引ける（?email=）', res.status === 200 && body.member === true, JSON.stringify(body));
}
{
  const res = await fetch(`${BASE}/api/members/check`, {
    method: 'DELETE', headers: { authorization: `Bearer ${API_KEY}` },
  });
  check('対応していないメソッドは405', res.status === 405, `status=${res.status}`);
}
{
  const res = await fetch(`${BASE}/api/members/check`, { method: 'OPTIONS' });
  check('ブラウザからの事前確認（OPTIONS）に応える', res.status === 204, `status=${res.status}`);
}
{
  const res = await fetch(`${BASE}/health`);
  const body = await res.json().catch(() => ({}));
  check('/health に入室チェックAPIの設定状況が出る', body.secrets?.memberApi === true, JSON.stringify(body));
}

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗\n`);
process.exit(failed ? 1 : 0);
