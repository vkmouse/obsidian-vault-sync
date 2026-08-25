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
/* Vault sync API 契約型別                                                    */
/* -------------------------------------------------------------------------- */

export interface ResolveVaultRequestBody {
  name: string
  candidateId: string
}

export interface ResolveVaultResponseBody {
  vaultId: string
}

export interface UploadBlobResponseBody {
  status: 'OK'
  uploadedAt: string
}
