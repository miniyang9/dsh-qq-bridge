import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Bridge } = await import('../src/app/bridge.js')

const root = 'C:/Project/WatchDog/.tmp/fake-title'
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })
const idx = 'C:/Project/WatchDog/.tmp/fake-title-ws.json'
fs.writeFileSync(idx, JSON.stringify({ tables: { workspaces: { w1: { path: 'C:\\Project\\WatchDog' } } } }))

const sent = []
const appended = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
const session = { id: 'session-new-9999', seq: 0, eventAt: () => null, append: (type, data) => appended.push([type, data]) }
const agent = { id: session.id, session }

const b = new Bridge({
  appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
  statePath: 'C:/Project/WatchDog/.tmp/t-title-' + Date.now() + '.json',
  sessionsRoot: root, workspaceIndex: idx, workspaceRoot: 'C:\\Project\\WatchDog',
  getSessionController: () => ({ async create() { return { sessionId: session.id } } }),
  getAgents: () => ({ get: (id) => (id === session.id ? agent : null) }),
  log: { info() {}, error() {} },
})
await b.start()
await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: '/new 1', author: { user_openid: 'u1' } } })

const title = appended.find(([t]) => t === 'session/title')
check('新建后写入 session/title', Boolean(title), JSON.stringify(appended))
check('标题只写 QQ（不再拼工作区）', title?.[1]?.title === 'QQ', title?.[1]?.title)
check('标题没有多余后缀', !/·/.test(title?.[1]?.title ?? ''), title?.[1]?.title)
check('回话仍然成功', (sent.at(-1) ?? '').includes('已在'), sent.at(-1))

// append 不存在时不得搞崩流程
const b2 = new Bridge({
  appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
  statePath: 'C:/Project/WatchDog/.tmp/t-title2-' + Date.now() + '.json',
  sessionsRoot: root, workspaceIndex: idx, workspaceRoot: 'C:\\Project\\WatchDog',
  getSessionController: () => ({ async create() { return { sessionId: 'session-noappend' } } }),
  getAgents: () => ({ get: () => ({ id: 'session-noappend', session: { id: 'session-noappend', seq: 0, eventAt: () => null } }) }),
  log: { info() {}, error() {} },
})
await b2.start()
await b2.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm2', content: '/new 1', author: { user_openid: 'u1' } } })
check('没有 append 方法时不影响新建', (sent.at(-1) ?? '').includes('已在'), sent.at(-1))

console.log('\n' + (failures.length === 0 ? 'S35 PASS' : 'S35 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
