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
/* Sync API (POST /api/sync) 契約型別                                         */
/*                                                                            */
/* plugin 端（obsidian-vault-sync-plugin/src/types.ts）也有一份形狀相同的    */
/* 定義，兩邊各自獨立維護、不共用同一個檔案，避免後端改內部結構時意外連動   */
/* 打斷前端。                                                                */
/* -------------------------------------------------------------------------- */

/** 對應 sync_events.entity_type。 */
export type EntityType = 'VAULT' | 'FILE'

export interface PushCommand {
  mutationId: string
  entityType: EntityType
  /** VAULT：要建立的 vaultId；FILE：所屬的 vaultId。全域佇列下每筆 command 得自帶。 */
  vaultId: string
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
  /** 使用者層級的全域游標位置，尚未同步過為 0。 */
  lastCursor: number
  pushCommands: PushCommand[]
}

/** Pull 流程回傳的單一筆伺服器端事件，對應 sync_events 一列。 */
export interface PullEvent {
  id: number
  vaultId: string
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
  /** 這個使用者名下所有 vault、lastCursor 之後的新事件（已排除本次請求自己的 mutationId）。 */
  pullEvents: PullEvent[]
}

/**
 * FILE 專用的寫入參數：vaultId 的歸屬權已在呼叫端驗證過，這裡不用重新檢查。
 */
export interface PutEntityParams {
  vaultId: string
  entityId: string
  baseVersion: number
  mutationId: string
  payloadJson: string
}
