import './_setup.mjs'
/**
 * 黑盒执行 · 第五批：列表/咨询隔离/重复答复/回执/越权控制
 * 覆盖 BB-22 / BB-39 / BB-60 / BB-51 / BB-62 / BB-70 / BB-71
 */
import fs from 'node:fs'

const results = []
const check = (id, ok, label, detail = '') => {
  results.push({ id, ok, label, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  — ' + detail : ''}`)
}

const { Bridge } = await import('../src/app/bridge.js')

const ROOT = '.tmp/bb5-sessions'
const IDX = '.tmp/bb5-ws.json'

function seedSessions(specs) {
  fs.rmSync(ROOT, { recursive: true, force: true })
  for (const s of specs) {
    const dir = `${ROOT}/--C-Project-WatchDog--/${s.id}`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/session.v4.jsonl`, JSON.stringify({ type: 'session', id: s.id, cwd: '.', delegationDepth: 0, agentPreset: 'standard' }))
  }
  fs.writeFileSync(IDX, JSON.stringify({ global: { archivedSessionIds: [] }, tables: { workspaces: { w1: { path: '.' } } } }))
}

function makeBridge(extra = {}) {
  const sent = []
  const client = {
    on() {}, async start() {}, async stop() {},
    async sendPassive(a) { sent.push(a.content); return { id: 'p' } },
    async sendProactive(a) { sent.push(a.content); return { id: 'a' } },
  }
  const b = new Bridge({
    appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
    statePath: `.tmp/bb5-${Date.now()}-${Math.random()}.json`,
    sessionsRoot: ROOT, workspaceIndex: IDX, workspaceRoot: '.',
    log: { info() {}, error() {} }, ...extra,
  })
  const inbound = (content, id) => b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content, author: { user_openid: 'u1' } } })
  return { b, sent, inbound }
}

const agent = (sid, extra = {}) => ({ id: sid, session: { id: sid, seq: 0, eventAt: () => null }, ...extra })

// ---------- BB-60 / BB-39：/list 字段与状态 ----------
{
  seedSessions([{ id: 'session-aaaa1111' }, { id: 'session-bbbb2222' }, { id: 'session-cccc3333' }])
  const { b, sent, inbound } = makeBridge()
  await b.start()
  b.bindAgent(agent('session-aaaa1111'))
  b.bindAgent(agent('session-bbbb2222'))
  await inbound('/list', 'm1')
  const reply = sent.at(-1) ?? ''
  const lines = reply.split('\n').filter((l) => /^\d+\)/.test(l.trim()))
  check('BB-60', lines.length === 3, '条目数 = 3', String(lines.length))
  check('BB-60', lines.every((l) => /^\d+\) [0-9a-f]{6} ·/.test(l.trim())), '每行含 序号 + 短id', lines[0]?.trim())
  const states = lines.map((l) => (l.match(/｜(空闲|运行中|未加载)｜/) ?? [])[1])
  check('BB-60', states.every((s) => ['空闲', '运行中', '未加载'].includes(s)), '状态值都在封闭集合内', states.join(','))
  check('BB-60', lines.filter((l) => l.includes('已绑定')).length >= 1, '绑定标记出现 ≥1 处')

  const unloaded = states.filter((s) => s === '未加载').length
  check('BB-39', unloaded === 1, '/list 中未加载 = 1（其余已加载）', String(unloaded))
  check('BB-39', reply.length <= 800, '回话 ≤800 字', String(reply.length))
}

// ---------- BB-22：咨询会话不出现在 /list ----------
{
  seedSessions([{ id: 'session-dddd4444' }, { id: 'session-eeee5555' }])
  let n = 0
  const { b, sent, inbound } = makeBridge({
    getSessionController: () => ({ async createSession() { n += 1; return { sessionId: `consult-${n}` } } }),
    getAgents: () => ({ get: (id) => agent(id) }),
  })
  await b.start()
  await inbound('/why 1 它为什么停', 'm1')
  const consultId = [...b.consults.values()][0]?.consultId
  check('BB-22', Boolean(consultId), '咨询通道已建立', String(consultId))
  await inbound('/list', 'm2')
  const reply = sent.at(-1) ?? ''
  check('BB-22', !reply.includes(String(consultId)), 'C1 标识出现 0 次', String(consultId))
  check('BB-22', reply.split('\n').filter((l) => /^\d+\)/.test(l.trim())).length === 2, '任务会话条数 = 2')
}

// ---------- BB-51：500ms 内两次 /yes ----------
{
  seedSessions([])
  const { b, sent, inbound } = makeBridge({ mergeMs: 0 })
  await b.start()
  const p = b.handleApproval({ agent: agent('session-ffff6666'), toolName: 'fs.read', callId: 'P5', args: {} }, { timeoutMs: 2000 })
  await new Promise((r) => setTimeout(r, 20))
  const id = b.points.list().at(-1).id
  await inbound(`/yes ${id}`, 'm1')
  await inbound(`/yes ${id}`, 'm2')
  const second = sent.at(-1) ?? ''
  check('BB-51', second.includes('已处理') || second.includes('已处理过'), '第 2 条回话含「已处理」', second.slice(0, 40))
  check('BB-51', b.points.get(id).status === 'resolved', '状态只被改 1 次', b.points.get(id).status)
  check('BB-51', (await p) === 'allowed-once', '审批结果为 allowed')
}

// ---------- BB-62：三种答复的回执文案 ----------
{
  seedSessions([])
  const { b, sent, inbound } = makeBridge({ mergeMs: 0 })
  await b.start()
  const pA = b.handleApproval({ agent: agent('session-g1'), toolName: 'fs.read', callId: 'P6', args: {} }, { timeoutMs: 2000 })
  const pB = b.handleApproval({ agent: agent('session-g2'), toolName: 'fs.read', callId: 'Q6', args: {} }, { timeoutMs: 2000 })
  await new Promise((r) => setTimeout(r, 20))
  const [id1, id2] = b.points.list().filter((x) => x.status === 'open').map((x) => x.id)
  await inbound(`/yes ${id1}`, 'm1')
  const r1 = sent.at(-1) ?? ''
  await inbound(`/no ${id2}`, 'm2')
  const r2 = sent.at(-1) ?? ''
  check('BB-62', r1.includes(id1), '回执含对应 requestId（yes）', r1.slice(0, 40))
  check('BB-62', r2.includes(id2), '回执含对应 requestId（no）', r2.slice(0, 40))
  check('BB-62', r1.length <= 800 && r2.length <= 800, '回执 ≤800 字', `${r1.length},${r2.length}`)
  b.points.drop(id1, 'cleanup'); b.points.drop(id2, 'cleanup')
  await Promise.all([pA, pB]).catch(() => {})
}

// ---------- BB-70：未绑定 / 运行中 的 /say 被拒 ----------
{
  seedSessions([{ id: 'session-hhhh7777' }, { id: 'session-iiii8888' }])
  const { b, sent, inbound } = makeBridge()
  await b.start()
  const st = (id, events) => ({ id, session: { id, seq: events.length, eventAt: (i) => events[i] } })
  b.bindAgent(st('session-hhhh7777', []))
  b.bindAgent(st('session-iiii8888', [{ type: 'turn/start' }]))
  b.boundAgent = null
  const before = sent.length
  await inbound('/say session-hhhh7777 hi-A', 'm1')
  const r1 = sent.at(-1) ?? ''
  // 空闲且已加载 → 进入确认（D20：给了 id 就不要求先 /use）
  check('BB-70', r1.includes('将要发送'), '空闲会话进入确认', r1.split('\n')[0])
  // 清掉待答点，避免影响下一条
  for (const p of b.points.list()) if (p.status === 'open') b.points.drop(p.id, 'test-cleanup')
  await inbound('/say session-iiii8888 hi-B', 'm2')
  const r2 = sent.at(-1) ?? ''
  check('BB-70', /正在跑|运行中/.test(r2), '运行中的目标被拒绝', r2.split('\n')[0])
  check('BB-70', sent.length - before === 2, '2/2 都有回话', String(sent.length - before))
  check('BB-70', !r2.includes('将要发送'), '运行中的目标没有进入确认')
}

// ---------- BB-71：标注请求拒绝 /ans 1，只认 /yes ----------
{
  seedSessions([])
  const { b, sent, inbound } = makeBridge({ mergeMs: 0 })
  await b.start()
  const p = b.handleApproval({ agent: agent('session-jjjj9999'), toolName: 'fs.write', args: { sandbox_permissions: 'x' }, callId: 'P7' }, { timeoutMs: 2000 })
  await new Promise((r) => setTimeout(r, 20))
  const id = b.points.list().at(-1).id
  await inbound(`/ans ${id} 1`, 'm1')
  const r1 = sent.at(-1) ?? ''
  check('BB-71', b.points.get(id).status === 'open', '/ans 1 后状态变化 0 次', b.points.get(id).status)
  check('BB-71', r1.includes('/yes') && r1.includes(id), '回话指向 /yes 与 id', r1.slice(0, 50))
  await inbound(`/yes ${id}`, 'm2')
  check('BB-71', b.points.get(id).status === 'resolved', '/yes 后状态变化 ≥1 次', b.points.get(id).status)
  check('BB-71', (await p) === 'allowed-once', '最终 allowed')
}

const fail = results.filter((r) => !r.ok)
console.log(`\n${fail.length === 0 ? 'BATCH-5 PASS' : 'BATCH-5 FAIL'}  (${results.length - fail.length}/${results.length})`)
fs.writeFileSync('.tmp/bb-batch5.json', JSON.stringify(results, null, 2))
process.exit(fail.length === 0 ? 0 : 1)
