const failures = []
const check = (ok,label,detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { Bridge } = await import('../src/app/bridge.js')
const sent = []
const client = { on(){}, async start(){}, async stop(){}, async sendPassive(a){ sent.push(a.content); return {id:'p'} }, async sendProactive(a){ sent.push(a.content); return {id:'a'} } }
const injected = []
let counter = 0
const sc = { async createSession(){ counter += 1; return { sessionId: 'consult-' + counter } } }
const agents = { get: (id) => ({ id, inject: (m) => injected.push({ id, m }) }) }
const b = new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath:'C:/Project/WatchDog/.tmp/t-c-'+Date.now()+'.json', sessionsRoot:'C:/Project/WatchDog/.tmp/fake-ws', workspaceIndex:'C:/Project/WatchDog/.tmp/fake-workspace.json', getSessionController:()=>sc, getAgents:()=>agents, log:{info(){},error(){}} })
await b.start()
const inbound = (c,id) => b.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id, content:c, author:{ user_openid:'u1' } } })
// 直接给一个已知会话 id
await inbound('/why sess-zzz 它为什么停住了', 'm1')
check(injected.length === 1, '问题投进咨询会话', String(injected.length))
check(b.consults.size === 1, '建了一条咨询通道')
const entry = [...b.consults.values()][0]
await b.onSessionEvent({ id: entry.consultId }, { type:'assistant/message', data:{ message:{ content:[{type:'text', text:'它在等一次权限确认'}] } } })
await b.onSessionEvent({ id: entry.consultId }, { type:'turn/end', data:{} })
check(sent.at(-1).includes('它在等一次权限确认'), '答话回传给 QQ', sent.at(-1).slice(0,40))
await inbound('/why sess-zzz 那为什么不直接改？', 'm2')
check(injected.length === 2, '同 id 追问复用同一条通道', String(injected.length))
check(b.consults.size === 1, '没有新建第二条通道')
await inbound('/done sess-zzz', 'm3')
check(sent.at(-1).includes('咨询已结束') && sent.at(-1).includes('共 2 轮'), '手动结束带轮数', sent.at(-1))
check(b.consults.size === 0, '通道已移除')
await inbound('/why sess-zzz 再问一句', 'm4')
check(b.consults.size === 1, '结束后可再起通道')
console.log('\n' + (failures.length===0?'S12 PASS':'S12 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)

