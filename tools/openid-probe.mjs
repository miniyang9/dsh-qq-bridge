/**
 * openid 探针：连上 QQ 官方机器人的 WebSocket 网关，把收到的单聊/群聊事件原文打印出来。
 *
 * 用途只有两个：
 *   1. 验证这个 AppID 能不能拿到 token、能不能连上网关（S2 的前半段）
 *   2. 拿到你的 openid（QQ 官方不给后台查，只能从"你给机器人发的那条消息"的事件里取）
 *
 * 用法：
 *   node tools/openid-probe.mjs
 * 然后在手机 QQ 里找到这个机器人，发一句任意内容（例如 "hi"）。
 * 事件到达后脚本会打印 user_openid / group_openid，Ctrl+C 结束。
 */
import fs from 'node:fs';

const ENV = 'C:\\Project\\WatchDog\\.env';
const API = process.env.QQ_API_BASE || 'https://api.sgroup.qq.com';
const SANDBOX_API = 'https://sandbox.api.sgroup.qq.com';

function readEnv(path) {
  const kv = {};
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) kv[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return kv;
}

const env = readEnv(ENV);
if (!env.AppID || !env.AppSecret) {
  console.error('缺少 AppID / AppSecret');
  process.exit(1);
}

const tr = await fetch('https://bots.qq.com/app/getAppAccessToken', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ appId: env.AppID, clientSecret: env.AppSecret }),
});
const tj = await tr.json();
if (!tj.access_token) {
  console.error('取 token 失败：', tr.status, JSON.stringify(tj));
  process.exit(1);
}
console.log('token ok, expires_in =', tj.expires_in);
const token = tj.access_token;
const auth = { Authorization: `QQBot ${token}` };

async function gateway(base) {
  const r = await fetch(`${base}/gateway`, { headers: auth });
  if (!r.ok) throw new Error(`${base} → ${r.status}`);
  return (await r.json()).url;
}

let wsUrl;
for (const base of [API, SANDBOX_API]) {
  try {
    wsUrl = await gateway(base);
    console.log('gateway:', base);
    break;
  } catch (e) {
    console.log('gateway 失败', String(e.message));
  }
}
if (!wsUrl) process.exit(1);

// intents: 1<<0 GUILDS | 1<<25 GROUP_AND_C2C_EVENT
const INTENTS = (1 << 0) | (1 << 25);
const ws = new WebSocket(wsUrl);
let seq = null;
let hb;

ws.addEventListener('open', () => console.log('ws open'));

ws.addEventListener('message', (ev) => {
  const payload = JSON.parse(String(ev.data));
  const { op, t, d, s } = payload;
  if (s) seq = s;

  if (op === 10) {
    const interval = d.heartbeat_interval ?? 41250;
    console.log('hello, heartbeat', interval, 'ms');
    ws.send(JSON.stringify({ op: 2, d: { token: `QQBot ${token}`, intents: INTENTS, shard: [0, 1], properties: {} } }));
    hb = setInterval(() => ws.send(JSON.stringify({ op: 1, d: seq })), interval);
    return;
  }
  if (op === 0) {
    console.log('\n[event]', t);
    const author = d?.author ?? {};
    if (author.user_openid) console.log('  user_openid =', author.user_openid);
    if (d?.group_openid) console.log('  group_openid =', d.group_openid);
    if (author.id) console.log('  author.id =', author.id);
    if (d?.content !== undefined) console.log('  content =', String(d.content).slice(0, 80));
    if (d?.id) console.log('  msg_id =', d.id);
    if (t === 'C2C_MESSAGE_CREATE') {
      console.log('\n把上面的 user_openid 填进 .env 的 QQ_ALLOWLIST，然后 Ctrl+C。');
    }
    return;
  }
  if (op === 9) {
    console.log('invalid session（token 或 intents 不对）', JSON.stringify(d).slice(0, 200));
  }
  if (op === 7) console.log('server 要求重连');
});

ws.addEventListener('error', (e) => console.log('ws error', e.message ?? e));
ws.addEventListener('close', (e) => {
  console.log('ws closed', e.code, e.reason);
  clearInterval(hb);
  process.exit(0);
});

console.log('等待事件……请在 QQ 里给机器人发一条消息（单聊或群聊都行）');
