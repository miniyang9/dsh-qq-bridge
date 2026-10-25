import './_setup.mjs'
/**
 * S1 验收：用**真实的 cordis**（从安装目录里的 app.asar 直接加载）跑一次 waterfall，
 * 断言"结果来自插件"，而不是 DSH 的默认回退 "unavailable"。
 *
 * 判据（arch 01 · 骨架 S1）：一次需审批操作由桥接决定 allowed/rejected，
 * 且不出现 unavailable；连续 5 次都如此。
 *
 * 跑法：用 Electron 当 node 执行（asar 里的 ESM 只有它认）：
 *   "DeepSeek Harness.exe" test/s1-waterfall.test.mjs
 */
import { pathToFileURL } from 'node:url';

const ASAR = '/home/<user>/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai';
const cordisUrl = pathToFileURL(`${ASAR}/cordis/lib/index.js`).href;

const failures = [];
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures.push(label);
}

const { Context } = await import(cordisUrl);
const plugin = await import(pathToFileURL('lib/index.js').href);

const ctx = new Context();
plugin.apply(ctx, { s1DefaultOutcome: 'rejected' });

const fakeAgent = { session: { id: 's1-fake-session' } };

async function ask(toolName) {
  const req = { agent: fakeAgent, toolName, callId: `call-${toolName}`, reason: 'S1 夹具' };
  // 与 ApprovalService.decide 的调用形状一致：waterfall(scope, event, subject, fallback)
  return ctx.waterfall(ctx, 'approval/request', req, () => Promise.resolve('unavailable'));
}

const results = [];
for (let i = 0; i < 5; i += 1) results.push(await ask(`tool-${i}`));

check(results.length === 5, '连续 5 次调用都有返回');
check(results.every((r) => r !== 'unavailable'), '没有任何一次落回 unavailable（即插件确实接管了）');
check(results.every((r) => r === 'rejected'), '5 次结果都等于插件给出的 rejected', results.join(','));
check(plugin.trace.length >= 5, 'trace 记录了 5 次接管', `trace=${plugin.trace.length}`);
check(plugin.trace.filter((t) => t.s1).every((t) => typeof t.toolName === 'string'), 'trace 保留了工具名（可审计）');

// 反向验证：不装插件时，同一调用必须回退成 unavailable（确认 fallback 常量没写错）
const bare = new Context();
const bareResult = await bare.waterfall(bare, 'approval/request', { agent: fakeAgent, toolName: 'x' }, () => Promise.resolve('unavailable'));
check(bareResult === 'unavailable', '对照组：没有插件时确实回退为 unavailable', String(bareResult));

console.log(`\n${failures.length === 0 ? 'S1 PASS' : 'S1 FAIL'}  (${5 - failures.length}/5 通过)`);
process.exit(failures.length === 0 ? 0 : 1);
