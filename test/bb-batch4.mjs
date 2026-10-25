const results = []
const check = (id, ok, label, detail='') => { results.push({id,ok,label,detail}); console.log(`${ok?'PASS':'FAIL'}  ${id}  ${label}${detail?'  — '+detail:''}`) }
const { Bridge } = await import('../src/app/bridge.js')
const sent = []
const client = { on(){}, async start(){}, async stop(){}, async sendPassive(a){ sent.push(a.content); return {id:'p'} }, async sendProactive(a){ sent.push(a.content); return {id:'a'} } }
const b = new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath:'C:/Project/WatchDog/.tmp/bb4-'+Date.now()+'.json', sessionsRoot:'C:/Project/WatchDog/.tmp/fake-none', log:{info(){},error(){}} })
b.mergeMs = 300
await b.start()
const agent = (sid) => ({ id: sid, session: { id: sid, seq: 0, eventAt: () => null } })
const pending = ['sA','sB','sC'].map((sid,i) => b.handleApproval({ agent: agent(sid), toolName:'fs.read', callId:'m'+i, args:{} }, { timeoutMs: 3000 }))
await new Promise(r => setTimeout(r, 500))
const cards = sent.slice()
check('BB-61', cards.length <= 2, '卡片条数 ≤2（合并发生）', String(cards.length))
const all = cards.join('\n')
const ids = ['wp-1','wp-2','wp-3'].filter(i => all.includes(i))
check('BB-61', ids.length === 3, '3 个 id 全部出现', ids.join(','))
check('BB-61', b.points.list().filter(p=>p.status==='open').length === 3, '静默丢弃 0 个（待答数=3）')
for (const p of b.points.list()) if (p.status==='open') b.points.drop(p.id,'cleanup')
await Promise.all(pending).catch(()=>{})
console.log('\n' + (results.every(r=>r.ok)?'BATCH-4 PASS':'BATCH-4 FAIL'))
process.exit(results.every(r=>r.ok)?0:1)
