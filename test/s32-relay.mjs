import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Bridge } = await import('../src/app/bridge.js')
const { parseCommand } = await import('../src/transport/envelope.js')

// 1) /ans 容错
check('/ans wp-1 1 发送 → 选项 1', parseCommand('/ans wp-1 1 发送').kind === 'option', JSON.stringify(parseCommand('/ans wp-1 1 发送')))
check('/ans wp-1 1 → 选项 1', parseCommand('/ans wp-1 1').index === 1)
check('/ans wp-1 这是文本 → 文本答复', parseCommand('/ans wp-1 这是文本').kind === 'answerText')

// 2) /say 注入后把回复带回来
const root = 'C:/Project/WatchDog/.tmp/fake-relay'
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root + '/--C-Project--/session-dd94c595-1111', { recursive: true })
fs.writeFileSync(root + '/--C-Project--/session-dd94c595-1111/session.v4.jsonl', JSON.stringify({ type: 'session', id: 'session-dd94c595-1111', cwd: 'C:/Project', delegationDepth: 0 }))

const sent = []
const injected = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
const session = { id: 'session-dd94c595-1111', seq: 0, eventAt: () => null }
const agent = { id: 'session-dd94c595-1111', session, inject: (m) => injected.push(m) }

const b = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath: 'C:/Project/WatchDog/.tmp/t-relay-' + Date.now() + '.json', sessionsRoot: root, log: { info() {}, error() {} } })
await b.start()
b.bindAgent(agent)

const inbound = (c, id) => b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content: c, author: { user_openid: 'u1' } } })
await inbound('/say dd94c5 你上一轮做了什么', 'm1')
const wp = b.points.list().at(-1)
check('注入前需要确认', injected.length === 0, String(injected.length))
await inbound(`/ans ${wp.id} 1`, 'm2')
check('确认后注入一次', injected.length === 1, String(injected.length))

// 模拟这一轮跑完：turn/start → assistant/message → turn/end
await b.onSessionEvent(session, { type: 'turn/start' })
await b.onSessionEvent(session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '我上一轮改了通知过滤并跑了测试。' }] } } })
await b.onSessionEvent(session, { type: 'turn/end' })

const relay = sent.find((s) => s.includes('回复：'))
check('turn 结束后把回复带回来一条', Boolean(relay), relay?.slice(0, 60))
check('带回的内容是那一轮的结论', (relay ?? '').includes('通知过滤'), relay)

console.log('\n' + (failures.length === 0 ? 'S32 PASS' : 'S32 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
