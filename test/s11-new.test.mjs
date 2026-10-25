import fs from 'node:fs'
const failures = []
const check = (ok, label, detail='') => { console.log((ok?'PASS  ':'FAIL  ')+label+(detail?'  — '+detail:'')); if(!ok) failures.push(label) }
const { Bridge } = await import('../src/app/bridge.js')
const root = 'C:/Project/WatchDog/.tmp/fake-ws2'; fs.rmSync(root,{recursive:true,force:true}); fs.mkdirSync(root,{recursive:true})
const wsIndex = 'C:/Project/WatchDog/.tmp/fake-workspace.json'
fs.writeFileSync(wsIndex, JSON.stringify({ tables: { workspaces: { 'ws-1': { path: 'C:\\Project\\WatchDog' }, 'ws-2': { path: 'C:\\Other' } } } }))
const sent = []; let created = []
const client = { on(){}, async start(){}, async stop(){}, async sendPassive(a){sent.push(a.content);return{id:'p'}}, async sendProactive(a){sent.push(a.content);return{id:'a'}} }
const sc = { async create(req) { created.push(req.workspaceId ?? req.cwd); return { sessionId: 'sess-new-1' } } }
const mk = (opts={}) => new Bridge({ appId:'x', appSecret:'y', allowlist:['u1'], client, statePath: opts.statePath ?? 'C:/Project/WatchDog/.tmp/t-new-RANDOM.json', sessionsRoot: root, workspaceIndex: wsIndex, getSessionController: () => sc, getAgents: () => null, maxNewPerWorkspacePerDay: 3, log:{info(){},error(){}} })
const shared = 'C:/Project/WatchDog/.tmp/t-new-' + Date.now() + '.json'
const b = mk({ statePath: shared })
await b.start()
await b.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id:'m1', content:'/new', author:{ user_openid:'u1' } } })
check(sent.at(-1).includes('在哪个工作区新建') && sent.at(-1).includes('C:\\Other'), '不带序号时列出工作区', sent.at(-1).split('\n')[0])
await b.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id:'m2', content:'/new 2', author:{ user_openid:'u1' } } })
check(created[0] === 'ws-2', '按序号在对应工作区新建', created[0])
check(sent.at(-1).includes('今天第 1/3'), '回话带当日计数', sent.at(-1))
for (let i=0;i<2;i++) await b.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id:'m'+(3+i), content:'/new 2', author:{ user_openid:'u1' } } })
check(created.length === 3, '同工作区共新建 3 次', String(created.length))
await b.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id:'m9', content:'/new 2', author:{ user_openid:'u1' } } })
check(sent.at(-1).includes('到上限了'), '第 4 次被拒', sent.at(-1))
const b2 = mk({ statePath: shared })
await b2.start()
await b2.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id:'m10', content:'/new 2', author:{ user_openid:'u1' } } })
check(sent.at(-1).includes('到上限了'), '重启后计数仍在（落盘生效）', sent.at(-1))
await b.onEvent({ type:'C2C_MESSAGE_CREATE', data:{ id:'m11', content:'/new C:\\evil', author:{ user_openid:'u1' } } })
check(sent.at(-1).includes('无效') && sent.at(-1).includes('只接受清单里的序号'), '手打路径被明确拒绝', sent.at(-1))
console.log('\n' + (failures.length===0?'S11 PASS':'S11 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length===0?0:1)
