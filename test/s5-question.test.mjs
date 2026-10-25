/**
 * S5 验收：user-questions 接缝 + 自由文本答复
 *
 * 覆盖：单问题 + 选项答复、单问题 + 自由文本、多问题让位、卡片文案。
 */
const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const { Bridge } = await import('../src/app/bridge.js')
const { renderQuestionCard } = await import('../src/transport/envelope.js')

function makeBridge() {
  const sent = []
  const client = {
    on() {}, async start() {}, async stop() {},
    async sendPassive(a) { sent.push(a.content); return { id: 'p' } },
    async sendProactive(a) { sent.push(a.content); return { id: 'a' } },
  }
  const bridge = new Bridge({
    appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
    statePath: `.tmp/t-q-${Date.now()}-${Math.random()}.json`,
    log: { info() {}, error() {} },
  })
  return { bridge, sent }
}

const inbound = (b, content, id) =>
  b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content, author: { user_openid: 'u1' } } })

// 卡片文案
const card = renderQuestionCard({ id: 'wp-9', question: { question: '用哪个方案？', options: [{ label: 'A' }, { label: 'B' }] } })
check(card.text.includes('用哪个方案？'), '卡片含问题')
check(card.text.includes('1) A') && card.text.includes('2) B'), '卡片含带序号的选项')
check(card.text.includes('/ans'), '卡片给出 /ans 命令（含自由文本形式）')
check(card.leakedRating.length === 0, '卡片无评级词')

// 1) 选项答复
{
  const { bridge } = makeBridge()
  await bridge.start()
  await inbound(bridge, 'go', 'm0')
  const p = bridge.handleQuestion({ questions: [{ id: 'q1', question: '用哪个方案？', options: [{ label: 'A' }, { label: 'B' }] }] }, { timeoutMs: 3000 })
  await new Promise((r) => setTimeout(r, 20))
  const id = bridge.points.list().at(-1).id
  await inbound(bridge, '/ans ' + bridge.points.list().at(-1).id + ' 2', 'm1')
  const res = await p
  check(res?.answers?.[0]?.id === 'q1', '答案回显 question id', JSON.stringify(res))
  check(JSON.stringify(res?.answers?.[0]?.selected) === '["B"]', '序号 2 → selected ["B"]', JSON.stringify(res?.answers?.[0]))
  check(bridge.points.get(id).status === 'resolved', '待答点 resolved')
}

// 2) 自由文本
{
  const { bridge } = makeBridge()
  await bridge.start()
  await inbound(bridge, 'go', 'm0')
  const p = bridge.handleQuestion({ questions: [{ id: 'q2', question: '用哪个方案？', options: [{ label: 'A' }] }] }, { timeoutMs: 3000 })
  await new Promise((r) => setTimeout(r, 20))
  await inbound(bridge, '/ans ' + bridge.points.list().at(-1).id + ' 用 B 方案，但先备份', 'm1')
  const res = await p
  check(res?.answers?.[0]?.custom === '用 B 方案，但先备份', '自由文本进 custom', JSON.stringify(res?.answers?.[0]))
  check(JSON.stringify(res?.answers?.[0]?.selected) === '[]', '自由文本时 selected 为空')
}

// 3) 多问题让位（返回 undefined，交给上层 next()）
{
  const { bridge } = makeBridge()
  await bridge.start()
  const res = await bridge.handleQuestion({ questions: [{ id: 'a', question: 'x' }, { id: 'b', question: 'y' }] }, { timeoutMs: 100 })
  check(res === undefined, '多问题请求让位（undefined）', String(res))
}

// 4) 超时：待答点 expire，返回 undefined
{
  const { bridge } = makeBridge()
  await bridge.start()
  await inbound(bridge, 'go', 'm0')
  const p = bridge.handleQuestion({ questions: [{ id: 'q4', question: '等你' }] }, { timeoutMs: 30 })
  const keep = setInterval(() => {}, 500)
  const res = await p
  clearInterval(keep)
  check(res === undefined, '超时后返回 undefined（不伪造答案）')
  check(bridge.points.list().at(-1).status === 'dropped', '待答点 dropped（桥接不自己 settle 成 expired）', bridge.points.list().at(-1).status)
}

console.log(`\n${failures.length === 0 ? 'S5 PASS' : 'S5 FAIL'}  (${failures.length} 条失败)`)
process.exit(failures.length === 0 ? 0 : 1)
