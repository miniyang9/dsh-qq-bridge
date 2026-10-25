import './_setup.mjs'
/**
 * S2 验收：通道层（脱网）
 *
 * 覆盖：
 *  - QqEnvelope：卡片只含事实、≤800 字、不出现评级词；入站解析封闭、失败不推定 approve
 *  - TokenStore：缓存、到期前刷新、并发只换一次
 *  - QQClient：hello→identify 帧正确、READY 置 ready、事件透传、被动回复带 msg_id
 *
 * 真机连通（token/长连/回传）已在 2026-10-24 手工验过，见 docs/build/qq-bridge.md。
 */
const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const { renderCard, parseCommand, dedupeKey } = await import('../src/transport/envelope.js')
const { TokenStore } = await import('../src/transport/auth.js')
const { QQClient } = await import('../src/transport/qq.js')

// ---------- 1. 卡片 ----------
const card = renderCard({
  id: 'wp-1',
  toolName: 'fs.write',
  reason: '写入工作区外文件',
  args: 'C:\\Program Files\\x.txt',
  target: '工作区外',
  reversible: false,
  options: ['批准', '拒绝'],
})
check(card.text.includes('wp-1'), '卡片带请求 id')
check(card.text.includes('fs.write'), '卡片带工具名')
check(card.text.includes('工作区外'), '卡片带影响范围')
check(card.text.includes('可撤回：否'), '卡片标出不可撤回')
check(card.text.includes('/why'), '卡片带 /why 提示')
check(card.text.includes('/ans wp-1 1'), '卡片带 /ans 命令')
check(card.leakedRating.length === 0, '卡片不含评级词', card.leakedRating.join(','))
check(card.text.length <= 800, '卡片 ≤800 字', String(card.text.length))

const longCard = renderCard({ id: 'wp-2', toolName: 'fs.write', reason: 'x'.repeat(2000) })
check(longCard.text.length <= 800 && longCard.truncated, '超长卡片被截断且标记', String(longCard.text.length))

// ---------- 2. 命令解析 ----------
const cases = [
  ['/yes wp-1', 'confirm'],
  ['/YES  wp-9 ', 'confirm'],
  ['/yes', 'unknown'], // 不带 id 不算确认
  ['/ans wp-1 1', 'option'],
  ['/ans wp-1 3', 'option'],
  ['/why wp-1', 'why'],
  ['/why', 'why'],
  ['/say 继续做第二步', 'say'],
  ['/list', 'list'],
  ['/progress', 'progress'],
  ['1', 'unknown'],
  ['差不多就行了', 'unknown'],
  ['', 'unknown'],
]
for (const [text, kind] of cases) {
  const got = parseCommand(text).kind
  check(got === kind, `parse(${JSON.stringify(text)}) → ${kind}`, got)
}
check(parseCommand('/yes wp-1').id === 'wp-1', 'confirm 带出 id')
check(dedupeKey('m1', 2) === 'm1#2', '去重键 = msgId#seq')

// ---------- 3. TokenStore ----------
let tokenCalls = 0
const fakeFetch = async (url) => {
  tokenCalls += 1
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: `tok-${tokenCalls}`, expires_in: 7200 }),
  }
}
let now = 1_000_000
const store = new TokenStore({ appId: 'a', appSecret: 's', fetchImpl: fakeFetch, now: () => now })
const t1 = await store.get()
const t2 = await store.get()
check(t1 === 'tok-1' && t2 === 'tok-1', '两次取 token 只换一次', String(tokenCalls))

const concurrent = await Promise.all([store.get(), store.get(), store.get()])
check(concurrent.every((t) => t === 'tok-1') && tokenCalls === 1, '并发取 token 仍只换一次', String(tokenCalls))

now += 7200 * 1000 // 越过有效期
const t3 = await store.get()
check(t3 === 'tok-2' && tokenCalls === 2, '到期后自动换新 token', String(tokenCalls))

// ---------- 4. QQClient（假 WebSocket）----------
class FakeWS {
  static instances = []
  constructor(url) {
    this.url = url
    this.sent = []
    this.listeners = new Map()
    FakeWS.instances.push(this)
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(fn)
  }
  send(raw) {
    this.sent.push(JSON.parse(raw))
  }
  close() {
    for (const fn of this.listeners.get('close') ?? []) fn({ code: 1000, reason: 'test' })
  }
  fire(type, payload) {
    for (const fn of this.listeners.get(type) ?? []) fn(payload)
  }
}

const gatewayFetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => ({ url: 'wss://fake.gateway/ws' }),
  text: async () => '{}',
})

const client = new QQClient({
  tokenStore: store,
  WebSocketImpl: FakeWS,
  fetchImpl: gatewayFetch,
  log: { info() {}, error() {} },
  reconnectBaseMs: 1,
})
const events = []
let ready = false
client.on('event', (e) => events.push(e))
client.on('ready', () => { ready = true; })

await client.start()
await new Promise((r) => setTimeout(r, 0))
const ws = FakeWS.instances.at(-1)
ws.fire('open', {})
ws.fire('message', { data: JSON.stringify({ op: 10, d: { heartbeat_interval: 41_250 } }) })
const identify = ws.sent.find((f) => f.op === 2)
check(!!identify, 'Hello 后发出 identify')
check(identify?.d?.token?.startsWith('QQBot '), 'identify 用 QQBot <token>', identify?.d?.token)
check(identify?.d?.intents === ((1 << 0) | (1 << 25)), 'identify 带 intents', String(identify?.d?.intents))

ws.fire('message', { data: JSON.stringify({ op: 0, t: 'READY', s: 1, d: { user: { id: 'bot' } } }) })
await new Promise((r) => setTimeout(r, 0))
check(ready && client.state === 'ready', 'READY 后进入 ready')

ws.fire('message', { data: JSON.stringify({ op: 0, t: 'C2C_MESSAGE_CREATE', s: 2, d: { id: 'm1', content: 'hi', author: { user_openid: 'u1' } } }) })
await new Promise((r) => setTimeout(r, 0))
check(events.length === 1 && events[0].type === 'C2C_MESSAGE_CREATE', '事件透传给上层', String(events.length))

let sent = null
client.fetch = async (url, init) => {
  sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }
  return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'msg-1' }) }
}
await client.sendPassive({ userOpenId: 'u1', msgId: 'm1', content: '收到' })
check(sent?.body?.msg_id === 'm1', '被动回复带 msg_id')
check(sent?.url.endsWith('/v2/users/u1/messages'), '回复打到单聊端点', sent?.url)
check(sent?.auth === 'QQBot tok-2', '回复带 QQBot 鉴权')

await client.stop()

console.log(`\n${failures.length === 0 ? 'S2 PASS' : 'S2 FAIL'}  (${failures.length} 条失败)`)
process.exit(failures.length === 0 ? 0 : 1)
