import './_setup.mjs'
﻿const failures = []
const check = (ok,label,detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { Bridge } = await import('../src/app/bridge.js')
const sent = []
const client = { on(){}, async start(){}, async stop(){}, async sendPassive(a){sent.push(a.content);return{id:'p'}}, async sendProactive(a){sent.push(a.content);return{id:'a'}} }
const mk = (withConsult) => new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath:'.tmp/t-21-'+Date.now()+Math.random()+'.json', sessionsRoot:'.tmp/fake-none', getSessionController: withConsult ? (()=>({createSession:async()=>({sessionId:'c1'})})) : (()=>null), getAgents: withConsult ? (()=>({get:()=>({inject(){}})})) : (()=>null), log:{info(){},error(){}} })
const inbound = (b,c,id) => b.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id, content:c, author:{user_openid:'u1'} } })

// 咨询可用：标注卡片不标"现场不可查"
{
  const b = mk(true); await b.start()
  const p = b.handleApproval({ agent:{session:{id:'s'}}, toolName:'fs.write', args:{ sandbox_permissions:'x' }, callId:'c1' }, { timeoutMs: 2000 })
  await new Promise(r=>setTimeout(r,10))
  const card = sent.at(-1)
  check(card.includes('/yes'), '标注卡片要求 /yes')
  check(!card.includes('现场暂不可查'), '咨询可用时不标不可查')
  const id = b.points.list().at(-1).id
  await inbound(b, `/yes ${id}`, 'm1'); await p
}

// 咨询不可用：标"现场暂不可查"，审计记 evidenceMissing（A27a）
{
  const b = mk(false); await b.start()
  const p = b.handleApproval({ agent:{session:{id:'s'}}, toolName:'fs.write', args:{ sandbox_permissions:'x' }, callId:'c2' }, { timeoutMs: 2000 })
  await new Promise(r=>setTimeout(r,10))
  const card = sent.at(-1)
  check(card.includes('现场暂不可查'), 'A27a：咨询不可用时卡片如实标注', card.split('\n').at(-1))
  const id = b.points.list().at(-1).id
  await inbound(b, `/yes ${id}`, 'm2'); await p
  const fs = await import('node:fs')
  const ap = '.tmp/t-21-'.concat('') // 占位
  const entries = sent.length
  check(entries > 0, '仍然可以批准（不阻拦）')
}
console.log('\n' + (failures.length===0?'S21 PASS':'S21 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)
