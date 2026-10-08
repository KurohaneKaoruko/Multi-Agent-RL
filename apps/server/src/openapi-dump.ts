// 导出 OpenAPI 文档到 apps/server/openapi.json（前端 gen:api 的输入）
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp, closeApp } from './app'

const tempData = mkdtempSync(path.join(tmpdir(), 'arlaf-openapi-'))
const app = await buildApp({ dataDir: tempData })
await app.ready()
const doc = app.swagger()
writeFileSync(new URL('../openapi.json', import.meta.url), JSON.stringify(doc, null, 2))
await closeApp(app)
console.log('openapi.json 已导出')
