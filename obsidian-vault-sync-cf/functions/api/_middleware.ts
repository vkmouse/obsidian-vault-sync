/**
 * 所有 `/api/*` 請求共用的身份解析：
 * 1. 讀取 Cloudflare Access 注入的 Cf-Access-Jwt-Assertion
 * 2. 驗證 Access JWT 的簽章、issuer、audience 與有效時間
 * 3. 從 JWT 的 common_name 解析到內部 email
 * 4. 再由 email 找出（或建立）內部 userId
 *
 * Access Application 本身仍應設定為保護整個 API 網域（例如 /api/* 或 /*），
 * 但 Worker 不應只信任 CF-Access-Client-Id；這裡直接驗證 JWT。
 */
import type { AuthContext, Env } from '../types'
import { findOrCreateUserId } from '../repositories/userRepository'
import {
  resolveEmailByCommonName,
  verifyAccessAssertion,
} from '../utils/access'

// initdb 負責建立資料表本身，此時 users 表可能還不存在，
// 因此這條路徑跳過 userId 解析，但仍然必須通過 Access JWT 驗證。
const SKIP_USER_RESOLUTION_PATHS = new Set(['/api/initdb'])

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { env, request } = context
  const { pathname } = new URL(request.url)

  const assertion = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!assertion) {
    return new Response('Unauthorized', { status: 401 })
  }

  const commonName = await verifyAccessAssertion(env, assertion)
  if (!commonName) {
    return new Response('Unauthorized', { status: 401 })
  }

  const email = resolveEmailByCommonName(env.SERVICE_IDENTITY_MAP, commonName)
  if (!email) {
    return new Response('Unauthorized', { status: 401 })
  }

  context.data.email = email

  if (SKIP_USER_RESOLUTION_PATHS.has(pathname)) {
    return await context.next()
  }

  context.data.userId = await findOrCreateUserId(env.DB, email)

  return await context.next()
}
