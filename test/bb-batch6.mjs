import './_setup.mjs'
﻿const results = []
const check = (id, ok, label, detail='') => { results.push({id,ok,label,detail}); console.log(`${ok?'PASS':'FAIL'}  ${id}  ${label}${detail?'  — '+detail:''}`) }
const fs = await import('node:fs')
const { Bridge } = await import('../src/app/bridge.js')
const ROOT='.tmp/bb6-s'; fs.rmSync(ROOT,{recursive:true,force:true})
for (const id of ['session-aaa11111','session-bbb22222']) {
  const d = `${ROOT}/--C-Project-WatchDog--/${id}`; fs.mkdirSync(d,{recursive:true})
  fs.writeFileSync(`${d}/session.v4.jsonl`, JSON.stringify({ type:'session', id, cwd:'.', delegationDepth:0, agentPreset:'standard' }))
}
const sent=[]; const injected=[]
const client={on(){},async start(){},async stop(){},async sendPassive(a){sent.push(a.content);return{id:'p'}},async sendProactive(a){sent.push(a.content);return{id:'a'}}}
const mkAgent=(id,events)=>({id,session:{id,seq:events.length,eventAt:i=>events[i]},inject:m=>injected.push({id,m})})
const b=new Bridge({appId:'x',appSecret:'y',allowlist:['u1'],client,statePath:'.tmp/bb6-'+Date.now()+'.json',sessionsRoot:ROOT,workspaceRoot:'.',log:{info(){},error(){}}})
await b.start()
const idle=mkAgent('session-aaa11111',[{type:'turn/end'}])
const busy=mkAgent('session-bbb22222',[{type:'turn/start'}])
b.bindAgent(idle); b.bindAgent(busy)
const inbound=(c,id)=>b.onEvent({type:'C2C_MESSAGE_CREATE',data:{id,content:c,author:{user_openid:'u1'}}})
// 指向运行中的会话：应拒绝
await inbound('/say session-bbb22222 hi-B','m1')
check('BB-70', (sent.at(-1)??'').match(/运行中|正在跑/)!==null, '运行中的会话被拒', sent.at(-1))
check('BB-70', injected.length===0, '注入 0 次')
// 指向空闲会话：应进入确认
await inbound('/say session-aaa11111 hi-A','m2')
check('BB-70', (sent.at(-1)??'').includes('将要发送'), '空闲会话进入确认', (sent.at(-1)??'').slice(0,30))
const wp=b.points.list().at(-1)
await inbound(`/ans ${wp.id} 1`,'m3')
check('D20', injected.length===1 && injected[0].id==='session-aaa11111', '确认后注入到指定会话', JSON.stringify(injected.map(x=>x.id)))
const fail=results.filter(r=>!r.ok)
console.log('\n'+(fail.length===0?'BATCH-6 PASS':'BATCH-6 FAIL')+` (${results.length-fail.length}/${results.length})`)
process.exit(fail.length===0?0:1)
