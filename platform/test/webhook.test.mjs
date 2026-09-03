/**
 * Webhook受信Workerのテスト
 * `npx wrangler dev` を起動した状態で `npm test` を実行します。
 *
 * 在庫管理のテストは「偽のStripe API」をこのプロセス内に立てて行います。
 * .dev.vars に STRIPE_API_BASE=http://127.0.0.1:4242（と .dev.vars.example の他の値）を
 * 書いておくと、まとめ買いの個数・売り切れ時のリンク無効化まで確認できます。
 * 書いていない場合は「1個として数える」予備の判定だけを確認します。
 */
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';

const BASE = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
const SECRET_TEST = process.env.STRIPE_WEBHOOK_SECRET_TEST || 'whsec_testmode_secret';
const PRICE_SPASUB = process.env.PRICE_SPASUB || 'price_spasub_test';
const PAYMENT_LINK_SPASUB = process.env.PAYMENT_LINK_SPASUB || 'plink_spasub_test';
const FAKE_STRIPE_PORT = Number(process.env.FAKE_STRIPE_PORT || 4242);
const FAKE_STRIPE_BASE = `http://127.0.0.1:${FAKE_STRIPE_PORT}`;

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

// 偽のStripe API（.dev.vars の STRIPE_API_BASE がここを向いているときだけ使われる）。
// 顧客の問い合わせには 404、決済の明細（line_items）と支払いリンクの無効化には応答する
// ローカルのDBは残り続けるので、決済IDと通知IDは実行のたびに変える（同じIDは二重処理防止で飛ばされる）
const RUN = Date.now().toString(36);
const sid = name => `${name}_${RUN}`;
const fake = {
  quantities: { [sid('cs_STOCK_1')]: 1, [sid('cs_STOCK_Q3')]: 3, [sid('cs_STOCK_T1')]: 1 },
  deactivated: [],
};
const fakeStripe = createServer((req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const m = req.url.match(/^\/v1\/checkout\/sessions\/([^/]+)\/line_items/);
  if (req.method === 'GET' && m) {
    const qty = fake.quantities[m[1]];
    return send(200, { object: 'list', data: qty ? [{ quantity: qty, price: { id: PRICE_SPASUB } }] : [] });
  }
  const pl = req.url.match(/^\/v1\/payment_links\/([^/?]+)$/);
  if (req.method === 'POST' && pl) { fake.deactivated.push(pl[1]); return send(200, { id: pl[1], active: false }); }
  send(404, { error: { message: 'not found (fake stripe)' } });
});
await new Promise((resolve, reject) => {
  fakeStripe.once('error', reject);
  fakeStripe.listen(FAKE_STRIPE_PORT, '127.0.0.1', resolve);
}).catch(err => console.log(`(偽のStripe APIを起動できませんでした: ${err.message})`));

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


console.log('\n== 在庫管理（スパサブ） ==');
const health = await fetch(`${BASE}/health`).then(r => r.json()).catch(() => ({}));
const fakeApi = health?.stock?.stripeApi === FAKE_STRIPE_BASE && health?.stock?.apiKey?.live === true;
if (!fakeApi) {
  console.log('  (.dev.vars に STRIPE_API_BASE などを書くと、明細取得・リンク無効化のテストも走ります → .dev.vars.example)');
}

const stock = async () => (await fetch(`${BASE}/stock`).then(r => r.json())).products?.spasub;
const purchase = (evtId, sessionId, extra = {}) => post(evt(evtId, 'checkout.session.completed', {
  id: sessionId,
  mode: 'payment',
  payment_link: PAYMENT_LINK_SPASUB,
  payment_intent: `pi_${sessionId}`,
  customer_details: { email: 'buyer@example.com' },
  ...extra,
}));

{
  const res = await fetch(`${BASE}/stock`);
  const body = await res.json();
  check('/stock が残数を返す', res.status === 200 && typeof body.products?.spasub?.stock === 'number', JSON.stringify(body));
  check('/stock は別ドメイン（HP）から読める', res.headers.get('access-control-allow-origin') === '*');
}
// 前回の実行で在庫が減ったままなら、ローカルDBを 600 に戻してから始める（ローカル開発のときだけ）
if (((await stock())?.stock ?? 0) < 10 && !process.env.WORKER_URL) {
  try {
    execSync(`npx wrangler d1 execute bcore-members --local --command "UPDATE inventory SET stock = 600, updated_at = strftime('%s','now') WHERE product = 'spasub';"`,
      { stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    console.log('  (ローカルの在庫を 600 に戻しました)');
  } catch {
    console.log('  (在庫が少なすぎます。npm run schema:local または UPDATE inventory SET stock = 600 で戻してください)');
  }
}
const s0 = (await stock()).stock;
{
  const r = await purchase(`evt_s1_${RUN}`, sid('cs_STOCK_1'));
  const s1 = (await stock()).stock;
  check('決済完了で在庫が1減る', r.status === 200 && s1 === s0 - 1, `status=${r.status} ${s0}→${s1}`);
}
{
  const r = await purchase(`evt_s1_${RUN}`, sid('cs_STOCK_1'));
  const s1 = (await stock()).stock;
  check('同じ通知の再送では減らない', r.body.duplicate === true && s1 === s0 - 1, `${s0}→${s1}`);
}
{
  const r = await purchase(`evt_s1b_${RUN}`, sid('cs_STOCK_1'));
  const s1 = (await stock()).stock;
  check('別の通知でも同じ決済なら減らない', r.status === 200 && s1 === s0 - 1, `${s0}→${s1}`);
}
{
  const r = await purchase(`evt_s2_${RUN}`, sid('cs_STOCK_Q3'));
  const s2 = (await stock()).stock;
  const expected = fakeApi ? 3 : 1;
  check(fakeApi ? 'まとめ買い（3個）は明細の個数だけ減る' : '明細が取れないときは1個として数える',
    r.status === 200 && s2 === s0 - 1 - expected, `${s0 - 1}→${s2}`);
}
{
  const before = (await stock()).stock;
  const r = await post(evt(`evt_s3_${RUN}`, 'checkout.session.completed', {
    id: sid('cs_SUB_1'), mode: 'subscription', customer: 'cus_TEST1',
    customer_details: { email: 'parent@example.com' },
  }));
  const after = (await stock()).stock;
  check('サブスク（ONLINE/OFFLINE）の申し込みでは減らない', r.status === 200 && after === before, `${before}→${after}`);
}
{
  const before = (await stock()).stock;
  const r = await post(evt(`evt_s4_${RUN}`, 'charge.refunded', { id: 'ch_1', payment_intent: `pi_${sid('cs_STOCK_1')}`, refunded: true }));
  const after = (await stock()).stock;
  check('全額返金で在庫が戻る', r.status === 200 && after === before + 1, `${before}→${after}`);
}
{
  const before = (await stock()).stock;
  const r = await post(evt(`evt_s5_${RUN}`, 'charge.refunded', { id: 'ch_1b', payment_intent: `pi_${sid('cs_STOCK_1')}`, refunded: true }));
  const after = (await stock()).stock;
  check('同じ注文を二度返金しても戻るのは一度だけ', r.status === 200 && after === before, `${before}→${after}`);
}
{
  const before = (await stock()).stock;
  const r = await post(evt(`evt_s6_${RUN}`, 'charge.refunded', { id: 'ch_2', payment_intent: `pi_${sid('cs_STOCK_Q3')}`, refunded: false, amount_refunded: 300 }));
  const after = (await stock()).stock;
  check('一部返金では在庫を動かさない', r.status === 200 && after === before, `${before}→${after}`);
}
{
  const before = (await stock()).stock;
  const r = await post(evt(`evt_s7_${RUN}`, 'checkout.session.completed', {
    id: sid('cs_OTHER_1'), mode: 'payment', payment_link: 'plink_unknown', payment_intent: 'pi_other',
  }));
  const after = (await stock()).stock;
  check('在庫対象でない商品の決済では減らない', r.status === 200 && after === before, `${before}→${after}`);
}
if (fakeApi) {
  const before = (await stock()).stock;
  fake.quantities[sid('cs_STOCK_ALL')] = before; // 残り全部を買う
  const r = await purchase(`evt_s8_${RUN}`, sid('cs_STOCK_ALL'));
  const info = await stock();
  check('残り0で soldOut が true になる', r.status === 200 && info.stock === 0 && info.soldOut === true, JSON.stringify(info));
  check('売り切れたら支払いリンクを無効化する', fake.deactivated.includes(PAYMENT_LINK_SPASUB), JSON.stringify(fake.deactivated));

  const r2 = await post(evt(`evt_s9_${RUN}`, 'charge.refunded', { id: 'ch_3', payment_intent: `pi_${sid('cs_STOCK_ALL')}`, refunded: true }));
  const after = (await stock()).stock;
  check('全額返金で在庫がもとに戻る', r2.status === 200 && after === before, `0→${after}（期待 ${before}）`);
}
{
  // テストモードの通知（livemode: false）はテスト用の合言葉で署名されて届く
  const e = evt(`evt_s10_${RUN}`, 'checkout.session.completed', {
    id: sid('cs_STOCK_T1'), mode: 'payment', payment_link: PAYMENT_LINK_SPASUB, payment_intent: 'pi_t1',
  }, false);
  const live = (await stock()).stock;
  const testBefore = (await fetch(`${BASE}/stock?test=1`).then(x => x.json())).products?.spasub?.stock;
  const rt = await post(e, sign(JSON.stringify(e), SECRET_TEST));
  const liveAfter = (await stock()).stock;
  const testAfter = (await fetch(`${BASE}/stock?test=1`).then(x => x.json())).products?.spasub?.stock;
  check('テストモードの決済は本番の在庫を減らさない', rt.status === 200 && liveAfter === live, `${live}→${liveAfter}`);
  check('テストモードの在庫（/stock?test=1）は別に減る', typeof testAfter === 'number' && testAfter === testBefore - 1, `${testBefore}→${testAfter}`);
}
fakeStripe.close();

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
