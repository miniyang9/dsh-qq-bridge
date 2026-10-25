import './_setup.mjs'
﻿import fs from 'node:fs'
const failures = []
const check = (ok,label,detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { Bridge } = await import('../src/app/bridge.js')
const root = '.tmp/fake-hidden'; fs.rmSync(root,{recursive:true,force:true})
fs.mkdirSync(root + '/--C-Project--/sess-user1', { recursive: true })
fs.writeFileSync(root + '/--C-Project--/sess-user1/session.v4.jsonl', JSON.stringify({ type:'session', id:'sess-user1', cwd:'C:/Project', delegationDepth:0, agentPreset:'standard' }))
const sent = []
const client = { on(){}, async start(){}, async stop(){}, async sendPassive(a){ sent.push(a.content); return {id:'p'} }, async sendProactive(a){ sent.push(a.content); return {id:'a'} } }
let n = 0
const sc = { async createSession(){ n += 1; return { sessionId: 'consult-' + n } } }
const agents = { get: (id) => ({ id, inject(){} }) }
const statePath = '.tmp/t-hidden-' + Date.now() + '.json'
const b = new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath, sessionsRoot: root, getSessionController:()=>sc, getAgents:()=>agents, log:{info(){},error(){}} })
await b.start()
const inbound = (c,id) => b.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id, content:c, author:{ user_openid:'u1' } } })
await inbound('/list', 'm0')
check(!sent.at(-1).includes('consult'), '/list 里没有咨询会话（此时还没建）')
await inbound('/why sess-user1 它为什么停', 'm1')
const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'))
check((saved.consults ?? []).includes('consult-1'), '咨询会话 id 落盘', JSON.stringify(saved.consults))
await inbound('/list', 'm2')
check(!sent.at(-1).includes('consult-1'), '咨询会话不出现在 /list（A36）', sent.at(-1).split('\n')[1])
console.log('\n' + (failures.length===0?'S13 PASS':'S13 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)
