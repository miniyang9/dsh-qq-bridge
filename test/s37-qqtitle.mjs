import './_setup.mjs'
import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Bridge } = await import('../src/app/bridge.js')

const root = '.tmp/fake-qqtitle'
fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true })
const idx = '.tmp/fake-qqtitle-ws.json'
fs.writeFileSync(idx, JSON.stringify({ tables: { workspaces: { 'ws-x': { path: '.' } } } }))

const sent = []
const titles = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
const session = { id: 'session-qq-title-1', seq: 0, eventAt: () => null, append: (t, d) => { if (t === 'session/title') titles.push(d.title) } }
const agent = { id: session.id, session, followup() {} }

const b = new Bridge({
  appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
  statePath: '.tmp/t-qqtitle-' + Date.now() + '.json',
  sessionsRoot: root, workspaceIndex: idx, workspaceRoot: '.',
  getSessionController: () => ({ async create() { return { sessionId: session.id } } }),
  getAgents: () => ({ get: () => agent }),
  log: { info() {}, error() {} },
})
await b.start()
await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: '/new 1', author: { user_openid: 'u1' } } })
check('建会话时只写 QQ', titles[0] === 'QQ', JSON.stringify(titles))

// 第一句话进来后补成 "QQ <首行>"
const inbound = (c, id) => b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content: c, author: { user_openid: 'u1' } } })
await inbound('/say 当前项目在干嘛？顺便看看测试', 'm2')
const wp = b.points.list().at(-1)
await inbound(`/ans ${wp.id} 1`, 'm3')
check('第一句话补进标题', titles.at(-1) === 'QQ 当前项目在干嘛？顺便看看测试'.slice(0, 23), titles.at(-1))
check('标题只有 QQ 前缀，没有工作区/时间', !/·/.test(titles.at(-1)), titles.at(-1))

console.log('\n' + (failures.length === 0 ? 'S37 PASS' : 'S37 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
