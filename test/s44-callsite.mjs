import './_setup.mjs'
/**
 * 调用点接线锁（R7 建议）
 *
 * s43 锁住了 outcomeFromVote / decisionFromOther 两个函数本身，
 * 但如果 bridge 的 GUI 分支又写回内联判断（不调用 decisionFromOther），
 * s43 仍然全绿——而线上 bug 会复活。
 *
 * 本用例构造"GUI 胜出、但手机那票已先结算"的确定时序：
 *   1) next() 返回一个由测试控制何时 resolve 的 promise
 *   2) 待答点出现后，把 points.drop 打成"返回 false"（模拟手机已结算）
 *   3) 让 GUI 先解析 → 进入迟到分支 → 分支等 qq
 *   4) 用 /yes 结算该点 → qq 解析 → 分支必须按"已生效票"返回 allowed
 * 若调用点退回内联 `text === '批准'`，/yes 会被判成 rejected，本用例变红。
 */
import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Bridge } = await import('../src/app/bridge.js')

const dir = '.tmp/t-callsite'
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })

const sent = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
const statePath = `${dir}/state.json`
const b = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath, sessionsRoot: dir + '/none', log: { info() {}, error() {} } })
await b.start()

let settleGui = null
const p = b.handleApproval(
  { agent: { session: { id: 's' } }, toolName: 'fs.write', callId: 'C-callsite', args: { sandbox_permissions: 'x' } },
  { next: () => new Promise((res) => { settleGui = res }) },
)
await new Promise((r) => setTimeout(r, 20))

const wp = b.points.list().at(-1)
check('待答点已建立', Boolean(wp?.id), wp?.id)

// 模拟"手机那票已经先结算"：drop 对 GUI 分支返回 false
b.points.drop = () => false
// GUI 先解析（此刻 qq 还没结算，race 会选 GUI）
settleGui('allowed')
await new Promise((r) => setTimeout(r, 10))
check('GUI 分支进入迟到路径（待答点仍 open）', b.points.get(wp.id)?.status === 'open', b.points.get(wp.id)?.status)

// 手机用 /yes 结算
await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: `/yes ${wp.id}`, author: { user_openid: 'u1' } } })
const outcome = await p
await new Promise((r) => setTimeout(r, 30))

const auditPath = statePath.replace(/\.json$/, '') + '.audit.jsonl'
const rows = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []

check('调用点按已生效票返回 allowed（/yes 不得被判 rejected）', outcome === 'allowed', String(outcome))
check('审计恰好 1 条', rows.length === 1, `audits=${rows.length}`)
check('审计票为 yes', JSON.parse(rows[0]?.outcome ?? '{}').text === 'yes', rows[0]?.outcome)
check('不向手机发"已在电脑端处理"', !sent.some((s) => s.includes('已在电脑端处理')), sent.slice(-2).join(' | '))

console.log('\n' + (failures.length === 0 ? 'S44 PASS' : 'S44 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
