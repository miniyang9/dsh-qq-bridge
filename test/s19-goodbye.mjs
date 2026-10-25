const failures = []
const check = (ok,label,detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { Bridge } = await import('../src/app/bridge.js')
const sent = []
const client = { on(){}, async start(){}, async stop(){ this.stopped = true }, async sendPassive(a){sent.push(a.content);return{id:'p'}}, async sendProactive(a){sent.push(a.content);return{id:'a'}} }
const b = new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath:'C:/Project/WatchDog/.tmp/t-19-'+Date.now()+'.json', sessionsRoot:'C:/Project/WatchDog/.tmp/fake-none', log:{info(){},error(){}} })
await b.start()
const ok = await b.sayGoodbye('我下班了（桥接退出）')
check(ok === true, 'A17：退出前发了最后一条')
check(sent.at(-1).includes('我下班了'), '内容是"我下班了"', sent.at(-1))
check(sent.length === 1, '只发一条，不发摘要', String(sent.length))
const b2 = new Bridge({ appId:'x', appSecret:'y', allowlist:[], client, statePath:'C:/Project/WatchDog/.tmp/t-19b-'+Date.now()+'.json', sessionsRoot:'C:/Project/WatchDog/.tmp/fake-none', log:{info(){},error(){}} })
check((await b2.sayGoodbye()) === false, '没有白名单时不假装发')
console.log('\n' + (failures.length===0?'S19 PASS':'S19 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)
