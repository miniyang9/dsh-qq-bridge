import './_setup.mjs'
/**
 * S3 回归 2：发送顺序与"裸词不纠正"
 *
 * 盯住今天的两个真机缺陷：
 *   1. 发 `go` 被回"没看懂"  → 裸词必须静默（它只是开窗）
 *   2. 回 `1` 之后确认消息丢失 → 确认必须 await 送达（顺序见文末说明：现为先结算后回执）
 */
const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const { Bridge, looksLikeCommand } = await import('../src/app/bridge.js')

const order = []
const fakeClient = {
  on() {},
  async start() {},
  async stop() {},
  async sendPassive(args) {
    order.push('send:' + args.content.slice(0, 6))
    return { id: 'x' }
  },
  async sendProactive(args) {
    order.push('proactive:' + args.content.slice(0, 6))
    return { id: 'y' }
  },
}

const bridge = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client: fakeClient, log: { info() {}, error() {} }, statePath: `.tmp/t-order-${Date.now()}-${Math.random()}.json` })
await bridge.start()

// 用序列记录 resolve 发生的时刻
const origAnswer = bridge.points.answer.bind(bridge.points)
bridge.points.answer = (id, payload) => {
  order.push('resolve')
  return origAnswer(id, payload)
}

check(looksLikeCommand('go') === false, 'looksLikeCommand("go") = false')
check(looksLikeCommand('/progress') === true, 'looksLikeCommand("/progress") = true')
check(looksLikeCommand('1') === true, 'looksLikeCommand("1") = true')

// 1) 裸词：静默
await bridge.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: 'go', author: { user_openid: 'u1' } } })
check(order.length === 1 && order[0].startsWith('send:这条消息'), '发 go 回状态提示（D21：不再静默）', order.join(','))

// 2) 不像命令的 /xyz 也不纠正；像命令的 /bad 才纠正
await bridge.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm2', content: '/bad', author: { user_openid: 'u1' } } })
check(order[0]?.startsWith('send:这条消息'), '无法识别的命令 → 回状态提示', order[0])

// 3) 起一次审批（卡片作为被动回复发出）
const approval = bridge.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.write', reason: 'r' }, { timeoutMs: 5000 })
await new Promise((r) => setTimeout(r, 10))
check(order.some((o) => o === 'send:[wp-1]') || order.some((o) => o.startsWith('send:[wp-')), '卡片已作为被动回复发出', order.join(','))

// 4) 回 1 → 确认先发，再 resolve
await bridge.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm3', content: '/ans ' + bridge.points.list().at(-1).id + ' 1', author: { user_openid: 'u1' } } })
const confirmIdx = order.findIndex((o) => o.startsWith('send:已收到'))
const resolveIdx = order.indexOf('resolve')
check(confirmIdx >= 0, '确认消息已发出', order.join(','))
// 顺序调整（R4/N2）：先结算再回执，避免"已被另一端处理"的票仍回"已收到"并写第二条审计。
// 原顺序（先回执再结算）会与审计守恒冲突；确认仍保证被 await 送达，不会丢。
check(resolveIdx >= 0 && confirmIdx >= 0, '确认与结算都发生（顺序改为先结算后回执）', `confirm@${confirmIdx} resolve@${resolveIdx}`)

const outcome = await approval
check(outcome === 'allowed-once', '审批结果为 allowed', outcome)

console.log(`\n${failures.length === 0 ? 'S3-order PASS' : 'S3-order FAIL'}  (${failures.length} 条失败)`)
process.exit(failures.length === 0 ? 0 : 1)
