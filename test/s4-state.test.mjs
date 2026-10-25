import './_setup.mjs'
/**
 * S4 验收：落盘 / 重启作废 / 推送去重 / 主动消息兜底
 *
 * 全部用假客户端 + 工作区内的临时 state 文件，不碰真 QQ。
 */
import fs from 'node:fs'
import path from 'node:path'

const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const { Bridge } = await import('../src/app/bridge.js')
const { JsonStore } = await import('../src/core/store.js')

const TMP = path.join('.tmp/s4')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

function makeClient() {
  const sent = []
  return {
    sent,
    on() {}, async start() {}, async stop() {},
    async sendPassive(a) { sent.push({ kind: 'passive', content: a.content, msgSeq: a.msgSeq }); return { id: 'p' } },
    async sendProactive(a) { sent.push({ kind: 'proactive', content: a.content }); return { id: 'a' } },
  }
}

function makeBridge(client, file) {
  return new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath: file, log: { info() {}, error() {} } })
}

// ---------- 1. 原子写与读回 ----------
{
  const file = path.join(TMP, 'a.state.json')
  const client = makeClient()
  const b = makeBridge(client, file)
  await b.start()
  // 走真实路径：开窗 → 发起审批 → 答复，才会触发 #persist
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm0', content: 'go', author: { user_openid: 'u1' } } })
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', callId: 'c0', reversible: true }, { timeoutMs: 3000 })
  await new Promise((r) => setTimeout(r, 20))
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: '/ans ' + b.points.list().at(-1).id + ' 1', author: { user_openid: 'u1' } } })
  check((await p) === 'allowed', '审批闭环仍为 allowed')
  await new Promise((r) => setTimeout(r, 50))

  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  check(saved.waitPoints.length === 1, '状态文件里有一条待答点', String(saved.waitPoints.length))
  check(saved.waitPoints[0].status === 'resolved', '落盘状态是 resolved', saved.waitPoints[0].status)
  check(!fs.existsSync(file + '.tmp') && fs.readdirSync(TMP).every((n) => !n.includes('.tmp-')), '没有残留临时文件')
}

// ---------- 2. 重启：open 的待答点作废 + 一句通知 ----------
{
  const file = path.join(TMP, 'b.state.json')
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    waitPoints: [{ id: 'wp-9', kind: 'approval', title: 't', status: 'open', createdAt: 1, meta: { toolName: 'fs.write', labeled: true } }],
    deliveries: {},
    interruption: null,
  }))

  const client = makeClient()
  const b = makeBridge(client, file)
  await b.start()
  await b.onReady()

  const after = JSON.parse(fs.readFileSync(file, 'utf8'))
  check(after.waitPoints[0].status === 'dropped', '重启后 open 待答点变 dropped', after.waitPoints[0].status)
  check(after.waitPoints[0].dropReason === 'restart', '作废原因是 restart', after.waitPoints[0].dropReason)
  check(client.sent.some((s) => s.content.includes('我重启过')), '发了一条"我重启过"的通知', client.sent.map((s) => s.kind).join(','))
  const notice = client.sent.find((s) => s.content.includes('我重启过'))
  check(!/待决\s*\d+/.test(notice?.content ?? ''), '通知里不声称"待决 N 条"', notice?.content)
}

// ---------- 3. 推送去重：同一请求 24h 内最多 3 条 ----------
{
  const file = path.join(TMP, 'c.state.json')
  const client = makeClient()
  const b = makeBridge(client, file)
  await b.start()

  const req = { agent: { session: { id: 's' } }, toolName: 'fs.read', callId: 'same-call', reversible: true }
  const pending = []
  for (let i = 0; i < 4; i += 1) pending.push(b.handleApproval(req, { timeoutMs: 40 }))
  // bridge 里的超时定时器是 unref 的（生产上不该拖住进程），测试里要自己撑住事件循环
  const keepAlive = setInterval(() => {}, 1000)
  const results = await Promise.all(pending)
  clearInterval(keepAlive)

  const pushes = client.sent.filter((s) => s.content.startsWith('['))
  check(pushes.length === 3, '同一 callId 24h 只推 3 条', String(pushes.length))
  check(results[3] === 'unavailable', '第 4 次被判 unavailable', results[3])
}

// ---------- 4. 没有被动窗口 → 主动消息兜底 ----------
{
  const file = path.join(TMP, 'd.state.json')
  const client = makeClient()
  const b = makeBridge(client, file)
  await b.start()
  // lastMsgId 保持 null
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', callId: 'c1', reversible: true }, { timeoutMs: 60 })
  await new Promise((r) => setTimeout(r, 20))
  check(client.sent[0]?.kind === 'proactive', '没有 msg_id 时走主动消息', client.sent[0]?.kind)
  await new Promise((r) => setTimeout(r, 120)) // 让 unref 的超时定时器有机会结算
}

// ---------- 4b. 磁盘上只剩终态时，新的一轮落盘不许把历史抹掉 ----------
{
  const file = path.join(TMP, 'f.state.json')
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    waitPoints: [
      { id: 'wp-a', kind: 'approval', title: 't', status: 'resolved', createdAt: 1, meta: { toolName: 'fs.read', labeled: false } },
      { id: 'wp-b', kind: 'question', title: 'q', status: 'dropped', createdAt: 2, meta: { toolName: null, labeled: false } },
    ],
    deliveries: {},
    interruption: null,
  }))

  const client = makeClient()
  const b = makeBridge(client, file)
  await b.start()
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm0', content: 'go', author: { user_openid: 'u1' } } })
  const keep = setInterval(() => {}, 500)
  await b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', callId: 'c9' }, { timeoutMs: 30 })
  clearInterval(keep)
  await new Promise((r) => setTimeout(r, 30))

  const after = JSON.parse(fs.readFileSync(file, 'utf8'))
  const ids = after.waitPoints.map((w) => w.id)
  check(ids.includes('wp-a') && ids.includes('wp-b'), '终态历史在再次落盘后仍在', ids.join(','))
}

// ---------- 5. 坏文件不崩 ----------
{
  const file = path.join(TMP, 'e.state.json')
  fs.writeFileSync(file, '{ not json')
  const store = new JsonStore(file)
  const loaded = await store.load()
  check(loaded.waitPoints.length === 0, '坏文件被容忍（返回空状态）')
  check(fs.readdirSync(TMP).some((n) => n.startsWith('e.state.json.bad-')), '坏文件被改名留证')
}

console.log(`\n${failures.length === 0 ? 'S4 PASS' : 'S4 FAIL'}  (${failures.length} 条失败)`)
process.exit(failures.length === 0 ? 0 : 1)
