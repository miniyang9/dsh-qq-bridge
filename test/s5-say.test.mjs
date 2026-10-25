/**
 * S5 验收：`/say` 续接已停会话
 *
 * 覆盖：无绑定会话时拒绝、有待答时拒绝、回显"上次停在哪"、1 才注入、2 取消。
 * 注入用假 agent 记录调用（真机 inject 形状未验证，见台账）。
 */
const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const { Bridge, lastStop, userMessage } = await import('../src/app/bridge.js')

function makeBridge() {
  const sent = []
  const injected = []
  const client = {
    on() {}, async start() {}, async stop() {},
    async sendPassive(a) { sent.push(a.content); return { id: 'p' } },
    async sendProactive(a) { sent.push(a.content); return { id: 'a' } },
  }
  const agent = {
    session: { seq: 2, eventAt: (i) => [{ type: 'turn/start' }, { type: 'turn/end', data: { at: 1_700_000_000_000 } }][i] },
    inject: (msg) => injected.push(msg),
  }
  const bridge = new Bridge({
    appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
    statePath: `.tmp/t-say-${Date.now()}-${Math.random()}.json`,
    log: { info() {}, error() {} },
  })
  return { bridge, sent, injected, agent }
}

const inbound = (b, content, id) =>
  b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content, author: { user_openid: 'u1' } } })

check(JSON.stringify(userMessage('hi').content) === '[{"type":"text","text":"hi"}]', 'userMessage 形状')
check(lastStop({ seq: 2, eventAt: (i) => [{ type: 'turn/start' }, { type: 'turn/end', data: { at: 1_700_000_000_000 } }][i] }).includes('上次 turn'), 'lastStop 能找到 turn/end')

// 1) 没有绑定会话 → 拒绝
{
  const { bridge, injected } = makeBridge()
  await bridge.start()
  await inbound(bridge, 'go', 'm0')
  await inbound(bridge, '/say 继续做第二步', 'm1')
  check(injected.length === 0, '没有绑定会话时不注入', String(injected.length))
}

// 2) 绑定后：回显 → 回 1 才注入
{
  const { bridge, sent, injected, agent } = makeBridge()
  await bridge.start()
  await inbound(bridge, 'go', 'm0')
  bridge.boundAgent = agent
  await inbound(bridge, '/say 继续做第二步', 'm1')
  const echo = sent.at(-1)
  check(echo.includes('将要发送') && echo.includes('上次停在'), '先回显内容与上次状态', echo.slice(0, 40))
  check(injected.length === 0, '确认前不注入')
  const id = bridge.points.list().at(-1).id
  await inbound(bridge, '/ans ' + bridge.points.list().at(-1).id + ' 1', 'm2')
  check(injected.length === 1, '回 1 后注入一次', String(injected.length))
  check(injected[0]?.content?.[0]?.text === '继续做第二步', '注入的就是原文本', JSON.stringify(injected[0]?.content))
  check(bridge.points.get(id).status === 'resolved', '待答点 resolved')
}

// 3) 回 2 取消
{
  const { bridge, injected, agent } = makeBridge()
  await bridge.start()
  await inbound(bridge, 'go', 'm0')
  bridge.boundAgent = agent
  await inbound(bridge, '/say 别发这个', 'm1')
  const id = bridge.points.list().at(-1).id
  await inbound(bridge, '/ans ' + bridge.points.list().at(-1).id + ' 2', 'm2')
  check(injected.length === 0, '回 2 不注入')
  check(bridge.points.get(id).status === 'dropped', '取消后 dropped', bridge.points.get(id).status)
}

// 4) 有待答请求时，先要求处理它
{
  const { bridge, agent } = makeBridge()
  await bridge.start()
  await inbound(bridge, 'go', 'm0')
  bridge.boundAgent = agent
  const p = bridge.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', args: {} }, { timeoutMs: 30 })
  await new Promise((r) => setTimeout(r, 5))
  await inbound(bridge, '/say 抢话', 'm1')
  check(bridge.points.list().filter((x) => x.kind === 'say').length === 0, '有待答时不创建 say 待答点')
  const keep = setInterval(() => {}, 300)
  await p
  clearInterval(keep)
}

console.log(`\n${failures.length === 0 ? 'S5-say PASS' : 'S5-say FAIL'}  (${failures.length} 条失败)`)
process.exit(failures.length === 0 ? 0 : 1)
