import './_setup.mjs'
const failures = []
const check = (ok,label,detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { Bridge } = await import('../src/app/bridge.js')
const sent = []
const client = { on(){}, async start(){}, async stop(){}, async sendPassive(a){sent.push(a.content);return{id:'p'}}, async sendProactive(a){sent.push(a.content);return{id:'a'}} }
let now = 1_000_000
const b = new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath:'.tmp/t-n-'+Date.now()+'.json', sessionsRoot:'.tmp/fake-none', getAgents:()=>null, getSessionController:()=>null, now: () => now, log:{info(){},error(){}} })
await b.start()
const sess = { id: 'sess-notify-1111' }
b.bindAgent({ id: 'sess-notify-1111', session: sess })
await b.onSessionEvent(sess, { type:'turn/start' })
check(sent.length === 0, 'turn 开始时没有通知')
now += 5 * 60_000; await b.tick()
check(sent.length === 0, '5 分钟不通知')
now += 6 * 60_000; await b.tick()
check(sent.length === 1 && sent[0].includes('没有新输出'), '10 分钟发停滞提醒（A30）', sent[0]?.slice(0,30))
await b.tick()
check(sent.length === 1, '同一轮不重复提醒')
now += 20 * 60_000; await b.tick()
check(sent.length === 2 && sent[1].includes('可能卡住'), '30 分钟再升一级', sent[1]?.slice(0,30))
await b.onSessionEvent(sess, { type:'turn/end' })
check(sent.length === 3 && sent[2].includes('它停了'), 'turn 结束发"等你下一句"（A24）', sent[2]?.slice(0,26))
await b.onSessionEvent(sess, { type:'turn/end' })
check(sent.length === 3, '重复 turn/end 不重复通知')
console.log('\n' + (failures.length===0?'S14 PASS':'S14 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)
