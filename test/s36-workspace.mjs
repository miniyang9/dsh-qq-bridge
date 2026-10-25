import fs from 'node:fs'
const failures=[]; const check=(l,ok,d='')=>{console.log((ok?'PASS  ':'FAIL  ')+l+(d?'  — '+d:''));if(!ok)failures.push(l)}
const { Bridge } = await import('../src/app/bridge.js')
const root='C:/Project/WatchDog/.tmp/fake-ws36'; fs.rmSync(root,{recursive:true,force:true}); fs.mkdirSync(root,{recursive:true})
const idx='C:/Project/WatchDog/.tmp/fake-ws36.json'
fs.writeFileSync(idx, JSON.stringify({tables:{workspaces:{'ws-abc':{path:'C:\\Project\\WatchDog'}}}}))
let seen=null
const client={on(){},async start(){},async stop(){},async sendPassive(a){return{id:'p'}},async sendProactive(a){return{id:'a'}}}
const sent=[]
client.sendPassive=(a)=>{sent.push(a.content);return{id:'p'}}
const b=new Bridge({appId:'x',appSecret:'y',allowlist:['u1'],client,statePath:'C:/Project/WatchDog/.tmp/t-ws36-'+Date.now()+'.json',sessionsRoot:root,workspaceIndex:idx,workspaceRoot:'C:\\Project\\WatchDog',
 getSessionController:()=>({async create(req){seen=req;return{sessionId:'session-ws36'}}}),
 getAgents:()=>({get:()=>({id:'session-ws36',session:{id:'session-ws36',seq:0,eventAt:()=>null,append(){}}})}),
 log:{info(){},error(){}}})
await b.start()
await b.onEvent({type:'C2C_MESSAGE_CREATE',data:{id:'m1',content:'/new 1',author:{user_openid:'u1'}}})
check('传 workspaceId', seen?.workspaceId==='ws-abc', JSON.stringify(seen))
check('不再同时传 cwd（互斥）', seen?.cwd===undefined, JSON.stringify(seen))
console.log('\n'+(failures.length===0?'S36 PASS':'S36 FAIL'))
process.exit(failures.length===0?0:1)
