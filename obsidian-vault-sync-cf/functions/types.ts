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

/** 對應 files.is_deleted / sync_events.action。 */
export type SyncAction = 'CREATE' | 'MODIFY' | 'DELETE'

export interface PushCommand {
  mutationId: string
  path: string
  action: SyncAction
  /** 這筆變更基於哪個版本做的；CREATE 固定為 0。 */
  baseVersion: number
  /** CREATE/MODIFY 帶已上傳好的 hash；DELETE 不需要。 */
  contentHash?: string
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
export interface SyncEventRow {
  id: number
  mutationId: string
  path: string
  action: SyncAction
  version: number
  contentHash: string | null
  createdAt: string
}

export interface SyncResponseBody {
  pushResults: PushResult[]
  /** 回應當下事件日誌的全域最大游標值。 */
  newCursor: number
  /** 這個 vault 裡 lastCursor 之後的新事件（已排除本次請求自己的 mutationId）。 */
  pullEvents: SyncEventRow[]
}
