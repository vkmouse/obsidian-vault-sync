/**
 * 初始化資料表，可重複呼叫。沒有正式資料，schema 變更用 DROP + CREATE
 * 而非 migration。
 */
import type { Env } from '../types'

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const { DB } = context.env

  await DB.batch([
    DB.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    DB.prepare(`
      CREATE TABLE IF NOT EXISTS vaults (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, name)
      )
    `),
    // 改成整包 zip 鏡像同步，不再需要 per-file 追蹤或事件日誌。
    DB.prepare(`DROP TABLE IF EXISTS files`),
    DB.prepare(`DROP TABLE IF EXISTS sync_events`),
    // ownership 查詢用 user_id 過濾，沒有這個 index 會退化成全表掃描。
    DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_vaults_user_id ON vaults (user_id)
    `),
  ])

  return Response.json({ status: 'OK' })
}
