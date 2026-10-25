import fs from 'node:fs'
const failures = []
const check = (ok,label,detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { Bridge, writeTargetOf } = await import('../src/app/bridge.js')
check(writeTargetOf('fs.write', '{"path":"a.ts"}')?.path === 'a.ts', '认出写工具并取路径')
check(writeTargetOf('fs.read', '{}') === null, '读工具不算写')
const sent = []
const client = { on(){}, async start(){}, async stop(){}, async sendPassive(a){sent.push(a.content);return{id:'p'}}, async sendProactive(a){sent.push(a.content);return{id:'a'}} }
const statePath = 'C:/Project/WatchDog/.tmp/t-w-'+Date.now()+'.json'
let n = 0
const sc = { async createSession(){ n+=1; return { sessionId:'consult-'+n } } }
const agents = { get:(id)=>({ id, inject(){} }) }
const b = new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath, sessionsRoot:'C:/Project/WatchDog/.tmp/fake-none', getSessionController:()=>sc, getAgents:()=>agents, log:{info(){},error(){}} })
await b.start()
await b.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id:'m1', content:'/why sess-x 改一下看看', author:{user_openid:'u1'} } })
const entry = [...b.consults.values()][0]
await b.onSessionEvent({ id: entry.consultId }, { type:'tool/call', data:{ name:'fs.write', arguments:'{"path":"src/a.js"}' } })
await b.onSessionEvent({ id: entry.consultId }, { type:'assistant/message', data:{ message:{ content:[{type:'text', text:'我改了 src/a.js'}] } } })
await b.onSessionEvent({ id: entry.consultId }, { type:'turn/end', data:{} })
const reply = sent.find(x => x.includes('第 1 轮'))
check(reply?.includes('本次改动：1 次写操作'), '回话给出改动次数（A19′）', reply?.slice(-60))
check(reply?.includes('src/a.js'), '回话给出路径')
const auditPath = statePath.replace(/\.json$/, '') + '.audit.jsonl'
const audit = fs.readFileSync(auditPath,'utf8').trim().split('\n').map(JSON.parse)
check(audit.some(e => e.card?.kind === 'consult-write'), '写操作进了审计')
console.log('\n' + (failures.length===0?'S15 PASS':'S15 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)
