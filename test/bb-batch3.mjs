/**
 * 黑盒执行 · 第三批：多会话与并发
 * 覆盖 BB-28 / BB-52 / BB-69（BB-61 的"合并"实现未做，单独记为缺口）
 */
import fs from 'node:fs'

const results = []
const check = (id, ok, label, detail = '') => {
  results.push({ id, ok, label, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  — ' + detail : ''}`)
}

const { Bridge } = await import('../src/app/bridge.js')
const { classify } = await import('../src/core/label.js')

function makeBridge() {
  const sent = []
  const client = {
    on() {}, async start() {}, async stop() {},
    async sendPassive(a) { sent.push(a.content); return { id: 'p' } },
    async sendProactive(a) { sent.push(a.content); return { id: 'a' } },
  }
  const b = new Bridge({
    appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
    statePath: `C:/Project/WatchDog/.tmp/bb3-${Date.now()}-${Math.random()}.json`,
    sessionsRoot: 'C:/Project/WatchDog/.tmp/fake-none',
    workspaceRoot: 'C:\\Project\\WatchDog',
    log: { info() {}, error() {} },
  })
  const inbound = (content, id) => b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content, author: { user_openid: 'u1' } } })
  return { b, sent, inbound }
}

const agent = (sid) => ({ id: sid, session: { id: sid, seq: 0, eventAt: () => null } })

// ---------- BB-28：三个会话同一秒各产生一个待答点 ----------
{
  const { b, sent } = makeBridge()
  await b.start()
  const before = sent.length
  const pending = ['sA', 'sB', 'sC'].map((sid, i) =>
    b.handleApproval({ agent: agent(sid), toolName: 'fs.read', callId: `c${i}`, args: {} }, { timeoutMs: 3000 }))
  await new Promise((r) => setTimeout(r, 30))
  const cards = sent.slice(before)
  check('BB-28', cards.length === 3, '卡片条数 = 3', String(cards.length))
  const ids = new Set(cards.map((c) => (c.match(/\[(wp-\d+)\]/) ?? [])[1]))
  check('BB-28', ids.size === 3, '三条互不相同（重复 0 条）', [...ids].join(','))
  const open = b.points.list().filter((p) => p.status === 'open').length
  check('BB-28', open === 3, '待答数 = 3', String(open))
  // 清理
  for (const p of b.points.list().filter((x) => x.status === 'open')) b.points.drop(p.id, 'cleanup')
  await Promise.all(pending).catch(() => {})
}

// ---------- BB-52：两个待答点，先答 P2 再答 P1，错绑 0 次 ----------
{
  const { b, sent, inbound } = makeBridge()
  await b.start()
  const p1 = b.handleApproval({ agent: agent('sess-p1'), toolName: 'fs.read', callId: 'P1', args: {} }, { timeoutMs: 3000 })
  const p2 = b.handleApproval({ agent: agent('sess-p2'), toolName: 'fs.read', callId: 'P2', args: {} }, { timeoutMs: 3000 })
  await new Promise((r) => setTimeout(r, 20))
  const ids = b.points.list().filter((x) => x.status === 'open').map((x) => x.id)
  const [id1, id2] = ids

  await inbound(`/yes ${id2}`, 'm1')
  check('BB-52', b.points.get(id2).status === 'resolved', 'P2 先被答复且 resolved', b.points.get(id2).status)
  check('BB-52', b.points.get(id1).status === 'open', 'P1 未被牵连（仍 open）', b.points.get(id1).status)

  await inbound(`/yes ${id1}`, 'm2')
  check('BB-52', b.points.get(id1).status === 'resolved', 'P1 随后 resolved', b.points.get(id1).status)
  const outcomes = await Promise.all([p1, p2])
  check('BB-52', outcomes.every((o) => o === 'allowed'), '两次都判 allowed（错绑 0 次）', outcomes.join(','))
  const audit = fs.readFileSync(b.audit.file, 'utf8').trim().split('\n').map(JSON.parse)
  // 契约变化（B7）：审计 requestId 优先记 callId（P1/P2），待答点 id 记在 wpId
  const refs = new Set(audit.flatMap((e) => [e.requestId, e.wpId]))
  check('BB-52', refs.has(id1) && refs.has(id2), '审计里两个请求各一条', [...refs].join(','))
}

// ---------- BB-69：同一工具+同一参数，跨会话标注结论一致 ----------
{
  const args = { path: 'C:\\Windows\\x.txt' }
  const one = classify({ toolName: 'fs.write', args, workspaceRoot: 'C:\\Project\\WatchDog', whitelist: [] })
  const two = classify({ toolName: 'fs.write', args, workspaceRoot: 'C:\\Project\\WatchDog', whitelist: [] })
  const three = classify({ toolName: 'fs.write', args, workspaceRoot: 'C:\\Project\\WatchDog', whitelist: [] })
  check('BB-69', one.labeled === two.labeled && two.labeled === three.labeled && one.reason === three.reason,
    '3 次同输入标注结论完全相同', JSON.stringify([one, two, three]))
  check('BB-69', one.labeled === true && one.reason === 'outside-workspace', '判为 outside-workspace', JSON.stringify(one))
  const read = classify({ toolName: 'fs.read', args, workspaceRoot: 'C:\\Project\\WatchDog', whitelist: [] })
  check('BB-69', read.labeled === false, '读工具（R1）不被标注')
}

const fail = results.filter((r) => !r.ok)
console.log(`\n${fail.length === 0 ? 'BATCH-3 PASS' : 'BATCH-3 FAIL'}  (${results.length - fail.length}/${results.length})`)
fs.writeFileSync('C:/Project/WatchDog/.tmp/bb-batch3.json', JSON.stringify(results, null, 2))
process.exit(fail.length === 0 ? 0 : 1)
