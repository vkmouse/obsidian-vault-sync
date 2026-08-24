/**
 * Cloudflare Pages Functions 共用的環境變數型別。
 * 所有 functions/api/*.ts 都透過 PagesFunction<Env> 取得 context.env。
 */
export interface Env {
  DB: D1Database
  BUCKET: R2Bucket
  /**
   * `CF-Access-Client-Id` → email 對照表，JSON 字串，例如：
   *   { "<clientId>": "alice@example.com" }
   * Client Id 本身不是敏感資訊，所以用一般環境變數（非 secret）存放即可。
   */
  SERVICE_TOKEN_MAP?: string
}

/**
 * 身份解析後注入的資料。兩個欄位都設計成 optional，因為有些路徑只解析到
 * email、不解析 userId；已知會設定兩者的端點可以放心用 `context.data.userId!`。
 */
export interface AuthContext extends Record<string, unknown> {
  email?: string
  userId?: string
}
