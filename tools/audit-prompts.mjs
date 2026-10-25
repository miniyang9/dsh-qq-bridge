import fs from 'node:fs'
const files = ['src/app/bridge.js','src/transport/envelope.js']
const bad = []
for (const f of files) {
  const lines = fs.readFileSync(f,'utf8').split('\n')
  lines.forEach((L,i) => {
    // 用户可见字符串里出现"回复/回 + 裸数字或序号"，且同一行没有 /命令
    if (!/回复|回(复)?\s*[0-9１-９]|回复序号|回复数字/.test(L)) return
    if (/^\s*(\/\/|\*|\/\*)/.test(L)) return
    if (L.includes('/')) return   // 已带命令就不算
    bad.push(`${f}:${i+1}: ${L.trim().slice(0,110)}`)
  })
}
console.log(bad.length ? bad.join('\n') : '（无）')
console.log('\n裸数字引导处数:', bad.length)
