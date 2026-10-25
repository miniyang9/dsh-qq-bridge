const failures = []
const check = (ok,label,detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { Bridge } = await import('../src/app/bridge.js')
const sent = []
let down = true
const client = {
  handlers: new Map(),
  on(t,f){ if(!this.handlers.has(t)) this.handlers.set(t,[]); this.handlers.get(t).push(f) },
  emit(t,p){ (this.handlers.get(t)??[]).forEach(f=>f(p)) },
  async start(){}, async stop(){},
  async sendPassive(a){ if(down) throw new Error('offline'); sent.push(a.content); return {id:'p'} },
  async sendProactive(a){ if(down) throw new Error('offline'); sent.push(a.content); return {id:'a'} },
}
const b = new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath:'.tmp/t-20-'+Date.now()+'.json', sessionsRoot:'.tmp/fake-none', log:{info(){},error(){}} })
await b.start()
await b.send('第一条（会失败）', null)
await b.send('第二条（会失败）', null)
check(b.failedSends === 2, '失败计数累计', String(b.failedSends))
check(sent.length === 0, '断网时没有送达')
down = false
client.emit('ready', {})
await new Promise(r=>setTimeout(r,20))
check(sent.length === 1, '恢复后只发 1 条摘要（A4：重复 0）', String(sent.length))
check(sent[0].includes('2 条没送达'), '摘要里给出条数', sent[0])
check(b.failedSends === 0, '计数清零')

// A5：非白名单一律不理
const before = sent.length
await b.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id:'x1', content:'/list', author:{ user_openid:'stranger' } } })
await new Promise(r=>setTimeout(r,20))
check(sent.length === before, 'A5：非白名单消息不回应', String(sent.length - before))
console.log('\n' + (failures.length===0?'S20 PASS':'S20 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)
