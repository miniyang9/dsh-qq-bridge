const failures = []
const check = (ok,label,detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { Bridge } = await import('../src/app/bridge.js')
const sent = []
const client = { on(){}, async start(){}, async stop(){}, async sendPassive(a){sent.push(a.content);return{id:'p'}}, async sendProactive(a){sent.push(a.content);return{id:'a'}} }
const mk = () => new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath:'.tmp/t-17-'+Date.now()+Math.random()+'.json', sessionsRoot:'.tmp/fake-none', log:{info(){},error(){}} })
const inbound = (b,c,id) => b.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id, content:c, author:{user_openid:'u1'} } })

// A9a：signal 中止 → cancelled，迟到答复不生效
{
  const b = await mk(); await b.start()
  const ac = new AbortController()
  const req = { agent:{ session:{ id:'s' } }, toolName:'fs.write', callId:'c-abort', args:{}, signal: ac.signal }
  const p = b.handleApproval(req)
  await new Promise(r=>setTimeout(r,10))
  const id = b.points.list().at(-1).id
  ac.abort()
  const outcome = await p
  check(outcome === 'cancelled', 'A9a：signal 中止 → cancelled', outcome)
  check(b.points.get(id).status === 'expired', 'A9a：待答点标 expired', b.points.get(id).status)
  await inbound(b, `/ans ${id} 1`, 'm1')
  check(sent.at(-1).includes('已失效') && sent.at(-1).includes('采纳'), 'A9a：迟到答复说明失效', sent.at(-1))
}

// A10：两个待答点，答复只作用于指定 id
{
  const b = await mk(); await b.start()
  const p1 = b.handleApproval({ agent:{session:{id:'s'}}, toolName:'fs.read', callId:'c1', args:{} }, { timeoutMs: 5000 })
  const p2 = b.handleApproval({ agent:{session:{id:'s'}}, toolName:'fs.read', callId:'c2', args:{} }, { timeoutMs: 5000 })
  await new Promise(r=>setTimeout(r,10))
  const ids = b.points.list().filter(x=>x.status==='open').map(x=>x.id)
  await inbound(b, `/ans ${ids[0]} 1`, 'm2')
  check(b.points.get(ids[0]).status === 'resolved', 'A10：指定 id 被处理', b.points.get(ids[0]).status)
  check(b.points.get(ids[1]).status === 'open', 'A10：另一个仍是 open（没被串台）', b.points.get(ids[1]).status)
  await inbound(b, `/ans ${ids[1]} 2`, 'm3')
  check(b.points.get(ids[1]).status === 'resolved', 'A10：第二个也能正常处理')
  const keep = setInterval(()=>{}, 300); await Promise.all([p1,p2]); clearInterval(keep)
}

// 已作废的请求，答复给出原因
{
  const b = await mk(); await b.start()
  const p = b.handleApproval({ agent:{session:{id:'s'}}, toolName:'fs.read', callId:'c3', args:{} }, { timeoutMs: 40 })
  await new Promise(r=>setTimeout(r,5))
  const id = b.points.list().at(-1).id
  const keep = setInterval(()=>{}, 300); await p; clearInterval(keep)
  await inbound(b, `/ans ${id} 1`, 'm4')
  check(sent.at(-1).includes('采纳'), '超时作废后答复被拒', sent.at(-1))
}
console.log('\n' + (failures.length===0?'S17 PASS':'S17 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)
