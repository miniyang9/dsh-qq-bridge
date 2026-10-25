import './_setup.mjs'
/**
 * S3 回归 3：`yes <id>` 的语义只在"被标注"的请求上收紧
 *
 *   普通请求（可撤回）：回 1 → 批准
 *   被标注请求（不可逆）：回 1 → 拒绝受理并提示 yes <id>；回 yes <id> → 批准
 */
const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const { Bridge } = await import('../src/app/bridge.js')
const { renderCard } = await import('../src/transport/envelope.js')

// 卡片文案层面
const plain = renderCard({ id: 'wp-1', toolName: 'fs.read', reversible: true })
const labeled = renderCard({ id: 'wp-2', toolName: 'fs.write', reversible: false, labeled: true })
check(plain.text.includes('1 批准') && !plain.text.includes('不可逆'), '普通卡片提示 1/2，不出现"不可逆"')
check(labeled.text.includes('不可逆') && labeled.text.includes('yes wp-2'), '被标注卡片要求 yes <id>')
check(!/回复 1 批准/.test(labeled.text), '被标注卡片不提示回 1')

function makeBridge() {
  const sent = []
  const client = {
    on() {}, async start() {}, async stop() {},
    async sendPassive(a) { sent.push(a.content); return { id: 'x' } },
    async sendProactive(a) { sent.push(a.content); return { id: 'y' } },
  }
  const bridge = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath: `.tmp/t-label-${Date.now()}-${Math.random()}.json`, log: { info() {}, error() {} } })
  return { bridge, sent }
}

const inbound = (bridge, content, id) =>
  bridge.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content, author: { user_openid: 'u1' } } })

// 1) 普通请求：回 1 直接批准
{
  const { bridge } = makeBridge()
  await bridge.start()
  await inbound(bridge, 'go', 'm0')
  const p = bridge.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', args: {} }, { timeoutMs: 3000 })
  await new Promise((r) => setTimeout(r, 10))
  await inbound(bridge, '/ans ' + bridge.points.list().at(-1).id + ' 1', 'm1')
  check((await p) === 'allowed', '普通请求：回 1 → allowed')
}

// 2) 被标注请求：回 1 不受理，仍 open；回 yes <id> 才批准
{
  const { bridge, sent } = makeBridge()
  await bridge.start()
  await inbound(bridge, 'go', 'm0')
  // 标注现在由 LabelPolicy 决定（S6）：用提权信号触发
  const p = bridge.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.write', args: { sandbox_permissions: 'danger-full-access' } }, { timeoutMs: 3000 })
  await new Promise((r) => setTimeout(r, 10))
  const id = bridge.points.list().at(-1).id

  await inbound(bridge, '/ans ' + bridge.points.list().at(-1).id + ' 1', 'm1')
  const wpAfter = bridge.points.get(id)
  check(wpAfter.status === 'open', '被标注请求：回 1 后仍 open（未被批准）', wpAfter.status)
  check(sent.at(-1).includes('/yes ' + id), '回 1 时回话里给出了 yes 指令', sent.at(-1).slice(0, 40))

  await inbound(bridge, `/yes ${id}`, 'm2')
  check(bridge.points.get(id).status === 'resolved', '被标注请求：yes <id> 后 resolved')
  check((await p) === 'allowed', '被标注请求：yes <id> → allowed')
}

console.log(`\n${failures.length === 0 ? 'S3-label PASS' : 'S3-label FAIL'}  (${failures.length} 条失败)`)
process.exit(failures.length === 0 ? 0 : 1)
