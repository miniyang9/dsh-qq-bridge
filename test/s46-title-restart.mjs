/**
 * 重启后首次 /say 仍应把 "QQ" 改成 "QQ <首句>"（真机事故）
 *
 * 事故：改名判定依赖内存集合 qqCreated，DSH 重启后集合为空，
 * 于是新建会话永远停在 "QQ"。现在判定改为"会话当前标题仍是 QQ"。
 */
import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Bridge } = await import('../src/app/bridge.js')

const dir = 'C:/Project/WatchDog/.tmp/t-title-restart'
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
const sent = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }

// 会话已有 "QQ" 标题事件（模拟重启前建的），内存集合为空
const events = [
  { type: 'session/title', data: { title: 'QQ', messageSeqs: [], source: { kind: 'user' } } },
  { type: 'turn/end', data: {} },
]
const appended = []
const session = {
  id: 'session-qq-restart-1',
  seq: events.length,
  eventAt: (i) => events[i],
  append: (type, data) => appended.push({ type, data }),
}
const agent = { id: session.id, session, followup() {} }

const b = new Bridge({
  appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
  statePath: `${dir}/state.json`, sessionsRoot: dir + '/none',
  log: { info() {}, error() {} },
})
await b.start()
check('重启后内存标记为空', b.qqCreated.size === 0, String(b.qqCreated.size))

const inbound = (c, id) => b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content: c, author: { user_openid: 'u1' } } })
// 直接把 agent 注册进 sessions，模拟"已加载"
b.sessions.set(session.id, { agent })
await inbound('/say session-qq-restart-1 把测试跑一遍', 'm1')
const wp = b.points.list().at(-1)
await inbound(`/ans ${wp.id} 1`, 'm2')

const renamed = appended.filter((x) => x.type === 'session/title').at(-1)
check('第一句话把标题改成 QQ <首句>', renamed?.data?.title === 'QQ 把测试跑一遍', renamed?.data?.title)
check('标题事件字段完整', Array.isArray(renamed?.data?.messageSeqs) && Boolean(renamed?.data?.source), JSON.stringify(renamed?.data))
check('消息已投递', appended.length >= 1)

console.log('\n' + (failures.length === 0 ? 'S46 PASS' : 'S46 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
