/**
 * 审批词表（真实事故的锁）
 *
 * DSH 的封闭词表是 allowed-once / rejected / cancelled / unavailable。
 * 我们早期用 'allowed'：GUI 点"允许"返回 allowed-once → 被归一成 rejected（谎报"用户拒绝"）；
 * 手机 /yes 返回 allowed → DSH 不认识 → 归一成 unavailable（工具不执行）。
 * 两条通道的批准都曾经无效，而 47 套测试全绿——因为测试跟着我们自己的词表写。
 */
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Bridge, outcomeFromVote } = await import('../src/app/bridge.js')

// 1) 票 → 结局必须是 DSH 词表
check('yes → allowed-once', outcomeFromVote('yes') === 'allowed-once', outcomeFromVote('yes'))
check('批准 → allowed-once', outcomeFromVote('批准') === 'allowed-once', outcomeFromVote('批准'))
check('拒绝 → rejected', outcomeFromVote('拒绝') === 'rejected', outcomeFromVote('拒绝'))

const dir = '.tmp/t-vocab'
const fs = await import('node:fs')
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
const sent = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
const mk = (tag) => new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath: `${dir}/state-${tag}.json`, sessionsRoot: dir + '/none', log: { info() {}, error() {} } })
const inbound = (b, content, id) => b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content, author: { user_openid: 'u1' } } })

// 2) GUI 通道：allowed-once 必须原样透传，不能被当成"不认识"
{
  const b = mk('gui'); await b.start()
  const out = await b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', callId: 'G1', args: {} }, { next: () => Promise.resolve('allowed-once') })
  check('GUI 允许 → allowed-once（不再变 rejected）', out === 'allowed-once', String(out))
}

// 3) 手机通道：/yes 也必须产出 allowed-once
{
  const b = mk('qq'); await b.start()
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', callId: 'Q1', args: {} }, { timeoutMs: 2000 })
  await new Promise((r) => setTimeout(r, 10))
  const wp = b.points.list().at(-1)
  await inbound(b, `/yes ${wp.id}`, 'm1')
  const out = await p
  check('手机 /yes → allowed-once', out === 'allowed-once', String(out))
}

// 4) 拒绝仍是 rejected
{
  const b = mk('no'); await b.start()
  const out = await b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', callId: 'N1', args: {} }, { next: () => Promise.resolve('rejected') })
  check('GUI 拒绝 → rejected', out === 'rejected', String(out))
}

console.log('\n' + (failures.length === 0 ? 'S45 PASS' : 'S45 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
