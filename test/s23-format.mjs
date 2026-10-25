const failures = []
const check = (ok,label,detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { Bridge } = await import('../src/app/bridge.js')
const sent = []
const client = { on(){}, async start(){}, async stop(){}, async sendPassive(a){sent.push(a.content);return{id:'p'}}, async sendProactive(a){sent.push(a.content);return{id:'a'}} }
let now = 1_000_000
const root = 'C:/Project/WatchDog/.tmp/fake-fmt'; const fs = await import('node:fs')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root + '/--C-Project--/session-aaaa1111', { recursive: true })
fs.writeFileSync(root + '/--C-Project--/session-aaaa1111/session.v4.jsonl', JSON.stringify({ type:'session', id:'session-aaaa1111', cwd:'C:/Project', delegationDepth:0, agentPreset:'standard' }))
const b = new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath:'C:/Project/WatchDog/.tmp/t-fmt-'+Date.now()+'.json', sessionsRoot: root, now: () => now, log:{info(){},error(){}} })
await b.start()
const sess = { id: 'session-aaaa1111' }
await b.onSessionEvent(sess, { type:'turn/start' })
await b.onSessionEvent(sess, { type:'tool/call', data:{ name:'fs.write' } })
await b.onSessionEvent(sess, { type:'tool/call', data:{ name:'fs.write' } })
now += 12 * 60_000
await b.onSessionEvent(sess, { type:'assistant/message', data:{ message:{ content:[{type:'text', text:'我把通知过滤改好了，并跑通全部测试。'}] } } })
await b.onSessionEvent(sess, { type:'turn/end' })
const m = sent.at(-1)
check(m.includes('[session-aaaa1111'.slice(0,0) + 'aaaa11') || m.includes('[aaaa11'), '带会话标识', m.split('\n')[0])
check(m.includes('本轮 12 分钟'), '带本轮耗时', m.split('\n')[1])
check(m.includes('我把通知过滤改好了'), '优先用人话首句', m.split('\n')[1])
check(m.includes('它停了'), '保留唤行动语')
check(m.length <= 300, '总长 ≤300', String(m.length))

// 没有人话时降级工具统计
sent.length = 0
now += 60000
await b.onSessionEvent(sess, { type:'turn/start' })
await b.onSessionEvent(sess, { type:'tool/call', data:{ name:'pwsh' } })
await b.onSessionEvent(sess, { type:'tool/call', data:{ name:'pwsh' } })
await b.onSessionEvent(sess, { type:'turn/end' })
check(sent.at(-1).includes('工具：pwsh ×2'), '无人话时降级工具统计', sent.at(-1).split('\n')[1])

// 停滞提醒同样带头
sent.length = 0
await b.onSessionEvent(sess, { type:'turn/start' })
now += 11 * 60_000
await b.tick()
const s1 = sent.at(-1)
check(s1.includes('[aaaa11') || s1.includes('aaaa11'), '停滞提醒带会话标识', s1.split('\n')[0])
check(s1.includes('11 分钟没有新输出'), '停滞提醒带分钟数', s1.split('\n')[1])
now += 20 * 60_000
await b.tick()
check(sent.at(-1).includes('可能卡住'), '30 分钟升级', sent.at(-1).split('\n')[1])

console.log('\n' + (failures.length===0?'S23 PASS':'S23 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)
