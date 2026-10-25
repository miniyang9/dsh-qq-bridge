import fs from 'node:fs'
const failures=[]; const check=(l,ok,d='')=>{console.log((ok?'PASS  ':'FAIL  ')+l+(d?'  — '+d:''));if(!ok)failures.push(l)}
const { Bridge } = await import('../src/app/bridge.js')
const root='.tmp/fake-say'; fs.rmSync(root,{recursive:true,force:true})
for (const id of ['session-dd94c595-1111']) { const d=root+'/--C-Project-WatchDog--/'+id; fs.mkdirSync(d,{recursive:true}); fs.writeFileSync(d+'/session.v4.jsonl', JSON.stringify({type:'session',id,cwd:'.',delegationDepth:0,agentPreset:'standard'})) }
const sent=[]; const injected=[]
const client={on(){},async start(){},async stop(){},async sendPassive(a){sent.push(a.content);return{id:'p'}},async sendProactive(a){sent.push(a.content);return{id:'a'}}}
const mk=(id)=>({id,session:{id,seq:0,eventAt:()=>null},inject:m=>injected.push({id,m})})
const b=new Bridge({appId:'x',appSecret:'y',allowlist:['u1'],client,statePath:'.tmp/t-say-'+Date.now()+'.json',sessionsRoot:root,getSessionController:()=>({async resolveAgent(id){return{agent:mk(id)}}}),log:{info(){},error(){}}})
await b.start(); b.bindAgent(mk('session-dd94c595-1111'))
const inbound=(c,id)=>b.onEvent({type:'C2C_MESSAGE_CREATE',data:{id,content:c,author:{user_openid:'u1'}}})

await inbound('/say doctor指令并不是我的原始诉求吧','m1')
let r=sent.at(-1)??''
check('无空格时不把首词当 id', r.includes('doctor指令并不是我的原始诉求吧'), r.split('\n')[0])
check('确认文案给 /ans 命令', r.includes('/ans wp-'), r.split('\n').at(-1))
const wp=b.points.list().at(-1)
await inbound(`/ans ${wp.id} 1`,'m2')
check('按 /ans 确认能注入', injected.length===1, String(injected.length))

await inbound('/say dd94c5 继续做','m3')
r=sent.at(-1)??''
check('带短 id 时 id 被识别（文本不含 id）', r.includes('将要发送：继续做'), r.split('\n')[0])
const wp2=b.points.list().at(-1)
await inbound(`/ans ${wp2.id} 1`,'m4')
check('注入到指定会话', injected.at(-1)?.id==='session-dd94c595-1111', JSON.stringify(injected.at(-1)?.id))
console.log('\n'+(failures.length===0?'S30 PASS':'S30 FAIL'))
process.exit(failures.length===0?0:1)
