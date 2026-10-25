import fs from 'node:fs'
const failures = []
const check = (label, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  — ' + detail : '')); if (!ok) failures.push(label) }

const { Bridge } = await import('../src/app/bridge.js')
const root = '.tmp/fake-ids'
fs.rmSync(root, { recursive: true, force: true })
const ids = ['session-dd94c595-1111', 'session-aaaa2222-3333']
for (const id of ids) {
  const d = root + '/--C-Project-WatchDog--/' + id
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(d + '/session.v4.jsonl', JSON.stringify({ type: 'session', id, cwd: '.', delegationDepth: 0, agentPreset: 'standard' }))
}

const sent = []
const injected = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
const mkAgent = (id, ev = [{ type: 'turn/end' }]) => ({ id, session: { id, seq: ev.length, eventAt: (i) => ev[i] }, inject: (m) => injected.push({ id, m }) })

let resumed = null
let consultN = 0
const sc = { async resume(id) { resumed = id; return mkAgent(id) }, async createSession() { consultN += 1; return { sessionId: 'consult-' + consultN } } }
const agents = { get: (id) => mkAgent(id) }

const b = new Bridge({
  appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
  statePath: '.tmp/t-ids-' + Date.now() + '.json',
  sessionsRoot: root, workspaceRoot: '.',
  getSessionController: () => sc, getAgents: () => agents,
  log: { info() {}, error() {} },
})
await b.start()
b.bindAgent(mkAgent('session-dd94c595-1111'))
b.bindAgent(mkAgent('session-aaaa2222-3333'))

const inbound = (c, id) => b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content: c, author: { user_openid: 'u1' } } })

await inbound('/use dd94c5', 'm1')
check('/use 接受短 id', (sent.at(-1) ?? '').includes('已绑定'), sent.at(-1))

await inbound('/wake aaaa22', 'm2')
check('/wake 接受短 id', /(已唤醒|已经加载着)/.test(sent.at(-1) ?? ''), sent.at(-1))

await inbound('/progress aaaa22', 'm3')
check('/progress 接受短 id', (sent.at(-1) ?? '').includes('会话'), (sent.at(-1) ?? '').slice(0, 24))

await inbound('/say aaaa22 hi', 'm4')
check('/say 接受短 id', (sent.at(-1) ?? '').includes('将要发送'), (sent.at(-1) ?? '').slice(0, 24))

const wp = b.points.list().at(-1)
await inbound(`/ans ${wp.id} 1`, 'm5')
check('/say 注入到指定会话', injected.some((x) => x.id === 'session-aaaa2222-3333'), JSON.stringify(injected.map((x) => x.id)))

await inbound('/why dd94c5 为什么停', 'm6')
check('/why 接受短 id', b.consults.has('session-dd94c595-1111'), [...b.consults.keys()].join(','))

check('/ans|/yes|/no 用独立的 wp-N 空间', /^wp-\d+$/.test(wp.id), wp.id)

console.log('\n' + (failures.length === 0 ? 'S27 PASS' : 'S27 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
