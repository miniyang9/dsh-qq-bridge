/**
 * 黑盒执行 · 第二批：参数校验与卡片格式
 * 覆盖 BB-16 / BB-18 / BB-55 / BB-56
 */
import fs from 'node:fs'

const results = []
const check = (id, ok, label, detail = '') => {
  results.push({ id, ok, label, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  — ' + detail : ''}`)
}

const { Bridge } = await import('../src/app/bridge.js')
const { renderCard } = await import('../src/transport/envelope.js')

const FIXED = ['未找到', '不存在', '无效', '超出']

function makeBridge(opts = {}) {
  const sent = []
  const client = {
    on() {}, async start() {}, async stop() {},
    async sendPassive(a) { sent.push(a.content); return { id: 'p' } },
    async sendProactive(a) { sent.push(a.content); return { id: 'a' } },
  }
  const b = new Bridge({
    appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
    statePath: `.tmp/bb2-${Date.now()}-${Math.random()}.json`,
    sessionsRoot: '.tmp/fake-none',
    log: { info() {}, error() {} },
    ...opts,
  })
  const inbound = (content, id) => b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content, author: { user_openid: 'u1' } } })
  return { b, sent, inbound }
}

// ---------- BB-16：/wake 非法参数 ----------
{
  const { b, sent, inbound } = makeBridge()
  await b.start()
  const before = sent.length
  for (const [i, cmd] of ['/wake 0', '/wake 99', '/wake'].entries()) await inbound(cmd, `w${i}`)
  const replies = sent.slice(before)
  check('BB-16', replies.length === 3, '3/3 收到回话', String(replies.length))
  check('BB-16', replies.every((r) => FIXED.some((w) => r.includes(w))), '3/3 含固定词表之一', replies.map((r) => FIXED.filter((w) => r.includes(w)).join('|')).join(' / '))
  check('BB-16', b.sessions.size === 0, '已加载会话数 +0', String(b.sessions.size))
}

// ---------- BB-18：/new 非法路径 ----------
{
  const ws = '.tmp/fake-ws3'
  fs.rmSync(ws, { recursive: true, force: true }); fs.mkdirSync(ws, { recursive: true })
  const idx = '.tmp/fake-ws3.json'
  fs.writeFileSync(idx, JSON.stringify({ tables: { workspaces: { 'w1': { path: '.' } } } }))
  let created = 0
  const { b, sent, inbound } = makeBridge({
    workspaceIndex: idx,
    getSessionController: () => ({ async createSession() { created += 1; return { sessionId: 's-new' } } }),
  })
  await b.start()
  const before = sent.length
  for (const [i, cmd] of ['/new C:\\Windows', '/new ../..', '/new D:\\tmp\\bb-unknown', '/new 1.5', '/new -1', '/new 9999'].entries()) {
    await inbound(cmd, `c${i}`)
  }
  const replies = sent.slice(before)
  check('BB-18', replies.length === 6, '6/6 收到回话', String(replies.length))
  check('BB-18', replies.every((r) => FIXED.some((w) => r.includes(w))), '6/6 含固定词表之一', replies.map((r) => FIXED.filter((w) => r.includes(w)).join('|')).join(' / '))
  check('BB-18', created === 0, '未创建任何会话', String(created))
}

// ---------- BB-55 / BB-56：卡片字段与命令格式 ----------
{
  const card = renderCard({
    id: 'wp-7', title: '需要你批准：fs.write', toolName: 'fs.write',
    reason: '写工作区外文件', args: '{"path":"C:\\\\Windows\\\\x.txt"}',
    target: '工作区外', reversible: false, labeled: true, options: ['批准', '拒绝'],
  })
  const fields = ['wp-7', 'fs.write', '写工作区外文件', '参数：', '影响范围：', '可撤回：', '/why wp-7']
  const hit = fields.filter((f) => card.text.includes(f)).length
  check('BB-55', hit === 7, '卡片字段齐备 7/7', `${hit}/7`)
  const five = ['危险', '谨慎', '注意', '不建议', '风险']
  const leaked = five.filter((w) => card.text.includes(w))
  check('BB-55', leaked.length === 0, '五词命中 0', leaked.join(','))
  check('BB-55', !/\b(rgb|color|#ff|等级|高|中|低)\b/i.test(card.text), '无颜色/等级标记')

  const cmds = ['/yes wp-7', '/no wp-7', '/why wp-7']
  check('BB-56', cmds.every((c) => card.text.includes(c)), '三种命令各出现 ≥1 次', cmds.filter((c) => !card.text.includes(c)).join(',') || 'ok')
  check('BB-56', !/回复\s*1|回复数字/.test(card.text), '无「回复 1」类裸数字表述')
  check('BB-56', card.text.includes('wp-7'), '命令中的 id 与卡片 id 一致')
}

const fail = results.filter((r) => !r.ok)
console.log(`\n${fail.length === 0 ? 'BATCH-2 PASS' : 'BATCH-2 FAIL'}  (${results.length - fail.length}/${results.length})`)
fs.writeFileSync('.tmp/bb-batch2.json', JSON.stringify(results, null, 2))
process.exit(fail.length === 0 ? 0 : 1)
