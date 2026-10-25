const failures = []
const check = (ok,label,detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { Bridge } = await import('../src/app/bridge.js')
const sent = []
const client = { on(){}, async start(){}, async stop(){}, async sendPassive(a){sent.push(a.content);return{id:'p'}}, async sendProactive(a){sent.push(a.content);return{id:'a'}} }
const events = [ {type:'turn/start'}, {type:'tool/call', data:{name:'fs.write'}}, {type:'assistant/message', data:{}} ]
const session = { id:'sess-p1', seq: events.length, eventAt: (i)=>events[i] }
const agent = { id:'sess-p1', session, inject(){} }
const b = new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath:'.tmp/t-p-'+Date.now()+'.json', sessionsRoot:'.tmp/fake-none', getAgents:()=>null, getSessionController:()=>null, log:{info(){},error(){}} })
await b.start()
const inbound = (c,id) => b.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id, content:c, author:{user_openid:'u1'} } })
await inbound('/progress','m0')
check(sent.at(-1).includes('还没绑定会话'), '未绑定时提示先 /use')
b.bindAgent(agent)
await inbound('/progress','m1')
const txt = sent.at(-1)
check(txt.includes('正在跑'), '报告 turn 状态（运行中）', txt.split('\n')[0])
check(txt.includes('待答请求：0'), '报告待答点数量')
check(txt.includes('tool/call(fs.write)'), '列出最近事件（含工具名）', txt.split('\n')[2])
await inbound('/progress sess-p1','m2')
check(sent.at(-1).includes('正在跑'), '带 id 也能查')
await inbound('/progress sess-other','m3')
check(sent.at(-1).includes('没加载'), '未加载会话明确报错', sent.at(-1))
console.log('\n' + (failures.length===0?'S16 PASS':'S16 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)
