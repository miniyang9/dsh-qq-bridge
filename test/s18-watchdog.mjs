const failures = []
const check = (ok,label,detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { QQClient } = await import('../src/transport/qq.js')

const instances = []
class FakeWS {
  constructor(u){ this.url=u; this.sent=[]; this.listeners=new Map(); instances.push(this) }
  addEventListener(t,f){ if(!this.listeners.has(t)) this.listeners.set(t,[]); this.listeners.get(t).push(f) }
  send(raw){ this.sent.push(JSON.parse(raw)) }
  close(){ (this.listeners.get('close')??[]).forEach(f=>f({code:1000})) }
  fire(t,p){ (this.listeners.get(t)??[]).forEach(f=>f(p)) }
}
const fetchImpl = async () => ({ ok:true, status:200, json: async()=>({ url:'wss://x' }), text: async()=>'{}' })
const store = { get: async()=>'tok' }
const rec = []
const c = new QQClient({ tokenStore: store, WebSocketImpl: FakeWS, fetchImpl, log:{info(){},error(){}}, reconnectBaseMs: 1 })
c.on('recovered', (e)=>rec.push(e))
await c.start()
await new Promise(r=>setTimeout(r,5))
const ws = instances[0]
ws.fire('message', { data: JSON.stringify({ op:10, d:{ heartbeat_interval: 1000 } }) })
ws.fire('message', { data: JSON.stringify({ op:0, t:'READY', s:1, d:{} }) })
check(c.state === 'ready', 'READY 后 ready')
check(c.recoverIfStale(Date.now() + 500) === false, '未超过 2 周期不触发')
check(c.recoverIfStale(Date.now() + 5000) === true, '超过 2 周期触发恢复（A14）')
await new Promise(r=>setTimeout(r,10))
check(instances.length >= 2, '触发了重连（新连接）', String(instances.length))
const ws2 = instances.at(-1)
ws2.fire('message', { data: JSON.stringify({ op:10, d:{ heartbeat_interval: 1000 } }) })
ws2.fire('message', { data: JSON.stringify({ op:0, t:'READY', s:1, d:{} }) })
check(rec.length === 1, '重连成功后发出 recovered 事件', String(rec.length))
await c.stop()
console.log('\n' + (failures.length===0?'S18 PASS':'S18 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)
