import './_setup.mjs'
/**
 * 提示语一致性检查：任何"让你输入什么"的提示都必须给出带 / 的完整命令。
 * 背景：连续出现过三次同类问题——卡片写"回复 1"、/say 确认写"回 1 发送"、/new 列表写"（回复序号）"，
 * 而 D21 之后裸数字一律不认。
 */
import fs from 'node:fs'

const failures = []
const check = (label, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  — ' + detail : '')); if (!ok) failures.push(label) }

const files = ['src/app/bridge.js', 'src/transport/envelope.js']
const userVisible = []

for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  lines.forEach((L, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(L)) return
    if (!/回复|输入|选择|确认|发送|取消/.test(L)) return
    if (/log\.(info|error)|catch|\/\*\*/.test(L)) return
    userVisible.push({ where: `${f}:${i + 1}`, text: L.trim() })
  })
}

// 1) 不许出现"回复序号/回复数字/回 1"这类裸输入引导
const bare = userVisible.filter((x) => /回复序号|回复数字|回复\s*[0-9１-９]|回\s*[0-9]\s*发送|回\s*[0-9]\s*取消/.test(x.text))
check('无裸数字引导', bare.length === 0, bare.map((b) => `${b.where}`).join(', '))

// 2) 凡"选择/确认"提示，必须出现 / 开头的命令
const needsCmd = userVisible.filter((x) => /（回复|请回|回复.*选择|选择.*序号/.test(x.text))
const missing = needsCmd.filter((x) => !/\/[a-z]/.test(x.text))
check('选择类提示都带 /命令', missing.length === 0, missing.map((m) => `${m.where}: ${m.text.slice(0, 50)}`).join(' | '))

// 3) /new 的列表提示必须示范用法
const src = fs.readFileSync('src/app/bridge.js', 'utf8')
check('/new 列表提示给了示例', /发 \/new <序号> 选择，例如 \/new 2/.test(src))

console.log('\n' + (failures.length === 0 ? 'S33 PASS' : 'S33 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
