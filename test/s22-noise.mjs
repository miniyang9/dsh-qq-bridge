const failures = []
const check = (ok,label,detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { Bridge } = await import('../src/app/bridge.js')
const sent = []
const client = { on(){}, async start(){}, async stop(){}, async sendPassive(a){sent.push(a.content);return{id:'p'}}, async sendProactive(a){sent.push(a.content);return{id:'a'}} }
const b = new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath:'C:/Project/WatchDog/.tmp/t-nb2-'+Date.now()+'.json', sessionsRoot:'C:/Project/WatchDog/.tmp/fake-none', log:{info(){},error(){}} })
await b.start()

// 真人会话，即使没绑定，也要提醒（长任务在别的会话里也能看见）
const main = { id: 'sess-main-1111' }
await b.onSessionEvent(main, { type:'turn/start' })
await b.onSessionEvent(main, { type:'turn/end' })
check(sent.length === 1 && sent[0].includes('它停了'), '未绑定的真人会话也提醒', String(sent.length))

// 子 agent 不提醒
const sub = { id: 'sess-sub-2222', origin: 'subagent', delegationDepth: 1 }
sent.length = 0
await b.onSessionEvent(sub, { type:'turn/start' })
await b.onSessionEvent(sub, { type:'turn/end' })
check(sent.length === 0, '子 agent 会话不提醒', String(sent.length))

// 咨询会话不提醒
sent.length = 0
b.state.consults = ['sess-c-3333']
await b.onSessionEvent({ id: 'sess-c-3333' }, { type:'turn/start' })
await b.onSessionEvent({ id: 'sess-c-3333' }, { type:'turn/end' })
check(sent.length === 0, '咨询会话不提醒', String(sent.length))

// 停滞提醒同样遵守
sent.length = 0
let now = Date.now()
const b2 = new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath:'C:/Project/WatchDog/.tmp/t-nb3-'+Date.now()+'.json', sessionsRoot:'C:/Project/WatchDog/.tmp/fake-none', now: () => now, log:{info(){},error(){}} })
await b2.start()
const sub2 = { id: 'sess-sub-4444', origin: 'subagent' }
await b2.onSessionEvent(sub2, { type:'turn/start' })
now += 11 * 60_000
await b2.tick()
check(sent.length === 0, '子 agent 卡住不发停滞提醒', String(sent.length))

console.log('\n' + (failures.length===0?'S22 PASS':'S22 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)
