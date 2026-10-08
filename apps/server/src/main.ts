import { buildApp } from './app'

const port = Number(process.env.PORT ?? 3000)
const dataDir = process.env.ARLAF_DATA ?? './data'

const app = await buildApp({ dataDir })
await app.listen({ port, host: '0.0.0.0' })
console.log(`ARLAF server 已启动：http://localhost:${port}（API 文档：/api/docs）`)
