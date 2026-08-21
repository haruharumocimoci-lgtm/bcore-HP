/**
 * Webhook受信Workerのテスト
 * `npx wrangler dev` を起動した状態で `npm test` を実行します。
 */
import { createHmac } from 'node:crypto';

const BASE = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
const SECRET_TEST = process.env.STRIPE_WEBHOOK_SECRET_TEST || 'whsec_testmode_secret';

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

function sign(payload, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

async function post(event, sigHeader) {
  const payload = JSON.stringify(event);
  const res = await fetch(`${BASE}/stripe/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sigHeader === null ? {} : { 'stripe-signature': sigHeader ?? sign(payload) }),
    },
    body: payload,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const evt = (id, type, object, livemode = true) => ({ id, type, livemode, data: { object } });

console.log('\n== 署名の検証 ==');
{
  const r = await post(evt('evt_bad_1', 'customer.created', { id: 'cus_x', email: 'a@example.com' }), 'bogus');
  check('壊れた署名は拒否する', r.status === 400, `status=${r.status}`);
}
{
  const r = await post(evt('evt_bad_2', 'customer.created', { id: 'cus_x' }), null);
  check('署名なしは拒否する', r.status === 400, `status=${r.status}`);
}
{
  const payload = JSON.stringify(evt('evt_bad_3', 'customer.created', { id: 'cus_x' }));
  const r = await post(evt('evt_bad_3', 'customer.created', { id: 'cus_x' }), sign(payload, 'whsec_wrong_key'));
  check('別のシークレットで署名された通知は拒否する', r.status === 400, `status=${r.status}`);
}
{
  const payload = JSON.stringify(evt('evt_bad_4', 'customer.created', { id: 'cus_x' }));
  const old = Math.floor(Date.now() / 1000) - 3600;
  const r = await post(evt('evt_bad_4', 'customer.created', { id: 'cus_x' }), sign(payload, SECRET, old));
  check('1時間前の古い通知は拒否する（リプレイ対策）', r.status === 400, `status=${r.status}`);
}

console.log('\n== 申し込みの流れ ==');
{
  const r = await post(evt('evt_1', 'checkout.session.completed', {
    customer: 'cus_TEST1',
    customer_details: { email: 'Parent@Example.com', name: '持丸 太郎' },
  }));
  check('決済完了を受け付ける', r.status === 200 && r.body.received === true, JSON.stringify(r));
}
{
  const r = await post(evt('evt_2', 'customer.subscription.created', {
    id: 'sub_TEST1',
    customer: 'cus_TEST1',
    status: 'active',
    cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_online_test' }, current_period_end: 1790000000 }] },
  }));
  check('サブスク開始を受け付ける', r.status === 200, JSON.stringify(r));
}
{
  const r = await post(evt('evt_2', 'customer.subscription.created', {
    id: 'sub_TEST1', customer: 'cus_TEST1', status: 'active', items: { data: [] },
  }));
  check('同じイベントの再送は二重処理しない', r.status === 200 && r.body.duplicate === true, JSON.stringify(r));
}

console.log('\n== 解約の流れ ==');
{
  const r = await post(evt('evt_3', 'customer.subscription.updated', {
    id: 'sub_TEST1',
    customer: 'cus_TEST1',
    status: 'active',
    cancel_at_period_end: true,
    items: { data: [{ price: { id: 'price_online_test' }, current_period_end: 1790000000 }] },
  }));
  check('期間末での解約予約を受け付ける', r.status === 200, JSON.stringify(r));
}
{
  const r = await post(evt('evt_4', 'customer.subscription.deleted', {
    id: 'sub_TEST1',
    customer: 'cus_TEST1',
    status: 'active', // Stripeはactiveのまま送ってくることがある
    cancel_at_period_end: true,
    items: { data: [{ price: { id: 'price_online_test' }, current_period_end: 1790000000 }] },
  }));
  check('解約完了を受け付ける', r.status === 200, JSON.stringify(r));
}

console.log('\n== 通知が逆順で届いた場合 ==');
// Stripeは順番を保証しないため、契約の通知が決済完了より先に届くことがある
{
  const r = await post(evt('evt_6', 'customer.subscription.created', {
    id: 'sub_TEST2',
    customer: 'cus_TEST2',
    status: 'active',
    items: { data: [{ price: { id: 'price_offline_test' }, current_period_end: 1790000001 }] },
  }));
  check('メールアドレス不明でも受け付ける', r.status === 200, JSON.stringify(r));
}
{
  const r = await post(evt('evt_7', 'checkout.session.completed', {
    customer: 'cus_TEST2',
    customer_details: { email: 'later@example.com', name: '後から判明' },
  }));
  check('あとから届いた決済完了を受け付ける', r.status === 200, JSON.stringify(r));
}

console.log('\n== テストモード ==');
// テストモードのStripeは別の合言葉で署名してくる。どちらでも受け付ける
{
  const e = evt('evt_t1', 'customer.updated', { id: 'cus_TESTMODE', email: 'sandbox@example.com' }, false);
  const payload = JSON.stringify(e);
  const r = await post(e, sign(payload, SECRET_TEST));
  check('テストモードの合言葉で署名された通知を受け付ける', r.status === 200, JSON.stringify(r));
}
{
  const e = evt('evt_t2', 'customer.updated', { id: 'cus_LIVEMODE', email: 'real@example.com' }, true);
  const payload = JSON.stringify(e);
  const r = await post(e, sign(payload, SECRET));
  check('本番の合言葉で署名された通知も引き続き受け付ける', r.status === 200, JSON.stringify(r));
}
{
  const e = evt('evt_t3', 'customer.updated', { id: 'cus_X' }, false);
  const payload = JSON.stringify(e);
  const r = await post(e, sign(payload, 'whsec_totally_unrelated'));
  check('どちらとも違う合言葉は拒否する', r.status === 400, JSON.stringify(r));
}

console.log('\n== 都度購入（PayPay / カード） ==');
// STOREの都度購入は mode:'payment' で届く。サブスクではないので
// subscriptions テーブルには何も入らない＝会員判定に影響しないことを確かめる
{
  const r = await post(evt('evt_p1', 'checkout.session.completed', {
    mode: 'payment',
    payment_method_types: ['paypay'],
    payment_status: 'paid',
    customer: 'cus_SPASUB1',
    customer_details: { email: 'Buyer@Example.com', name: '物販 太郎' },
  }));
  check('PayPayでの都度購入を受け付ける', r.status === 200 && r.body.received === true, JSON.stringify(r));
}
{
  // 支払いリンクの設定によっては顧客が作られないことがある。落ちないこと
  const r = await post(evt('evt_p2', 'checkout.session.completed', {
    mode: 'payment',
    payment_method_types: ['paypay'],
    payment_status: 'paid',
    customer: null,
    customer_details: { email: 'guest@example.com' },
  }));
  check('顧客なしの都度購入でも200を返す', r.status === 200, JSON.stringify(r));
}
{
  // 決済が後から確定するタイプの通知。未対応イベントとして無視されればよい
  const r = await post(evt('evt_p3', 'checkout.session.async_payment_succeeded', {
    mode: 'payment',
    customer: 'cus_SPASUB1',
  }));
  check('後から確定する決済の通知も200を返す', r.status === 200, JSON.stringify(r));
}

console.log('\n== その他 ==');
{
  const r = await post(evt('evt_5', 'invoice.payment_succeeded', { id: 'in_1' }));
  check('未対応のイベントも200を返す（Stripeの再送を招かない）', r.status === 200, JSON.stringify(r));
}
{
  const res = await fetch(`${BASE}/health`);
  check('/health が応答する', res.status === 200);
}

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗\n`);
process.exit(failed ? 1 : 0);
