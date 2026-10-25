/**
 * 测试统一入口：把 cwd 固定到仓库根，避免测试依赖"从哪个目录启动"。
 *
 * 背景：开源脱敏时把绝对路径改成了相对路径，导致任何人从别的目录跑测试都会红。
 * 每个测试文件第一行 `import './_setup.mjs'`，由它先 chdir 到仓库根。
 */
import { fileURLToPath } from 'node:url'

process.chdir(fileURLToPath(new URL('..', import.meta.url)))
