/**
 * 所有 `/api/*` 請求共用的身份解析：從 Header 找出使用者，換成內部 userId，
 * 交給後續端點使用。邊界層的密鑰驗證不在這裡，這裡只信任已經放行到 Worker
 * 的請求，並負責把外部憑證換成系統內部識別碼。
 */
import type { AuthContext, Env } from '../types'
import { resolveEmailByClientId } from '../utils/serviceTokenMap'
import { findOrCreateUserId } from '../repositories/userRepository'

// initdb 負責建立資料表本身，此時 users 表可能還不存在，
// 因此這條路徑跳過 userId 解析，避免對不存在的表下查詢而出錯。
const SKIP_USER_RESOLUTION_PATHS = new Set(['/api/initdb'])

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { env, request } = context
  const { pathname } = new URL(request.url)

  if (SKIP_USER_RESOLUTION_PATHS.has(pathname)) {
    return await context.next()
  }

  // 缺少此 header 代表請求繞過了邊界層驗證，理論上不會發生。
  const clientId = request.headers.get('CF-Access-Client-Id')
  if (!clientId) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 查無對應 email：這個 Client Id 有效，但沒有登記給任何使用者。
  const email = resolveEmailByClientId(env.SERVICE_TOKEN_MAP, clientId)
  if (!email) {
    return new Response('Forbidden', { status: 403 })
  }

  context.data.email = email

  context.data.userId = await findOrCreateUserId(env.DB, email)

  return await context.next()
}
