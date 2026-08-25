/**
 * Cloudflare Pages Functions 共用的環境變數型別。
 */
export interface Env {
  DB: D1Database
  BUCKET: R2Bucket

  /** Cloudflare Zero Trust / Access Team domain，例如：example.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string

  /** Cloudflare Access Application 的 Audience (AUD) / Application Audience Tag */
  ACCESS_AUD?: string

  /** Cloudflare Access JWT common_name → email 對照表（JSON 字串）。 */
  SERVICE_IDENTITY_MAP?: string
}

/**
 * 身份解析後注入的資料。
 */
export interface AuthContext extends Record<string, unknown> {
  email?: string
  userId?: string
}

/* -------------------------------------------------------------------------- */
/* Sync API (POST /api/vaults/{vaultId}/sync) 契約型別                        */
/*                                                                            */
/* plugin 端（obsidian-vault-sync-plugin/src/types.ts）也有一份形狀相同的    */
/* 定義，兩邊各自獨立維護、不共用同一個檔案，避免後端改內部結構時意外連動   */
/* 打斷前端。                                                                */
/* -------------------------------------------------------------------------- */

/** 對應 sync_events.entity_type。目前僅 'FILE'，之後可擴充。 */
export type EntityType = 'FILE'

export interface PushCommand {
  mutationId: string
  entityType: EntityType
  entityId: string
  baseVersion: number
  payload: string
}

export type PushResultStatus = 'OK' | 'SKIPPED' | 'ERROR'

export interface PushResult {
  mutationId: string
  status: PushResultStatus
}

export interface SyncRequestBody {
  /** 呼叫端上次同步到的游標位置，尚未同步過為 0。 */
  lastCursor: number
  pushCommands: PushCommand[]
}

/** Pull 流程回傳的單一筆伺服器端事件，對應 sync_events 一列。 */
export interface PullEvent {
  id: number
  mutationId: string
  entityType: EntityType
  entityId: string
  version: number
  payload: string | null
  createdAt: string
}

export interface SyncResponseBody {
  pushResults: PushResult[]
  /** 回應當下事件日誌的全域最大游標值。 */
  newCursor: number
  /** 這個 vault 裡 lastCursor 之後的新事件（已排除本次請求自己的 mutationId）。 */
  pullEvents: PullEvent[]
}

/**
 * vaultId 不放進 payload：files 的擁有權是複合 PK 的一部分，而
 * sync.ts 已經從路由參數驗證過歸屬權，不需要也不該讓它變成使用者可控欄位。
 */
export interface PutEntityParams {
  vaultId: string
  entityId: string
  baseVersion: number
  mutationId: string
  payloadJson: string
}

/** 回傳 null 代表這次寫入視為 ERROR；非 null 代表寫入成功且已寫好 sync_events。 */
export type PutEntityHandler = (db: D1Database, params: PutEntityParams) => Promise<unknown | null>
