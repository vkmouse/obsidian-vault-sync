/**
 * 建立系統所需的資料表。全部使用 `CREATE TABLE IF NOT EXISTS`，
 * 讓這支端點可以重複呼叫而不出錯，方便部署或環境初始化時直接呼叫,
 * 不用先確認表是否已存在。
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
    DB.prepare(`
      CREATE TABLE IF NOT EXISTS files (
        vault_id TEXT NOT NULL,
        path TEXT NOT NULL,
        version INTEGER NOT NULL,
        content_hash TEXT,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (vault_id, path),
        CHECK (content_hash IS NULL OR length(content_hash) = 64)
      )
    `),
    // 改成完全通用的事件日誌（不再認識 files 表的欄位語意），是 breaking
    // schema change；目前沒有正式資料，直接 DROP 再重建，不需要 migration。
    DB.prepare(`DROP TABLE IF EXISTS sync_events`),
    DB.prepare(`
      CREATE TABLE IF NOT EXISTS sync_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        vault_id    TEXT NOT NULL,
        mutation_id TEXT UNIQUE NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id   TEXT NOT NULL,
        payload     TEXT,
        version     INTEGER NOT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_sync_events_vault_id ON sync_events (vault_id, id)
    `),
    // pull 現在要 JOIN vaults 查「這個使用者名下所有 vault」，owner batch 查詢
    // 也是用 user_id 過濾，沒有這個 index 兩者都會退化成全表掃描。
    DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_vaults_user_id ON vaults (user_id)
    `),
  ])

  return Response.json({ status: 'OK' })
}
