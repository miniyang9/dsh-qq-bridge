import fs from 'node:fs'
const failures=[]; const check=(ok,l,d='')=>{console.log((ok?'PASS  ':'FAIL  ')+l+(d?'  — '+d:''));if(!ok)failures.push(l)}
const { Bridge } = await import('../src/app/bridge.js')
const root='.tmp/fake-ws-id'; fs.rmSync(root,{recursive:true,force:true})
fs.mkdirSync(root+'/--C-Project--/session-dd94c595-1111',{recursive:true})
fs.writeFileSync(root+'/--C-Project--/session-dd94c595-1111/session.v4.jsonl', JSON.stringify({type:'session',id:'session-dd94c595-1111',cwd:'C:/Project',delegationDepth:0}))
const sent=[]; const client={on(){},async start(){},async stop(){},async sendPassive(a){sent.push(a.content);return{id:'p'}},async sendProactive(a){sent.push(a.content);return{id:'a'}}}
let resumed=null
const sc={async resume(id){resumed=id;return{id,session:{id,seq:0,eventAt:()=>null}}}}
const b=new Bridge({appId:'x',appSecret:'y',allowlist:['u1'],client,statePath:'.tmp/t-wid-'+Date.now()+'.json',sessionsRoot:root,getSessionController:()=>sc,log:{info(){},error(){}}})
await b.start()
await b.onEvent({type:'C2C_MESSAGE_CREATE',data:{id:'m1',content:'/wake dd94c5',author:{user_openid:'u1'}}})
check(resumed==='session-dd94c595-1111','短 id 可唤醒', String(resumed))
check(sent.at(-1).includes('已唤醒'),'回话已唤醒', sent.at(-1))
await b.onEvent({type:'C2C_MESSAGE_CREATE',data:{id:'m2',content:'/wake zzzzzz',author:{user_openid:'u1'}}})
check(sent.at(-1).includes('无效'),'不存在的短 id 明确拒绝', sent.at(-1))
console.log('\n'+(failures.length===0?'S26 PASS':'S26 FAIL'))
process.exit(failures.length===0?0:1)
