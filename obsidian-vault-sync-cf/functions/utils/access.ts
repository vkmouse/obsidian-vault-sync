import type { Env } from '../types'

type JwtHeader = {
  alg?: string
  kid?: string
  typ?: string
}

type JwtPayload = {
  iss?: unknown
  aud?: unknown
  common_name?: unknown
  exp?: unknown
  nbf?: unknown
}

type Jwk = JsonWebKey & {
  kid?: string
  alg?: string
  use?: string
}

type JwksResponse = {
  keys?: Jwk[]
}

const jwksCache = new Map<string, { expiresAt: number; keys: Jwk[] }>()
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function decodeJson<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(value))) as T
  } catch {
    return null
  }
}

function hasAudience(payload: JwtPayload, expected: string): boolean {
  if (typeof payload.aud === 'string') return payload.aud === expected
  if (Array.isArray(payload.aud)) {
    return payload.aud.some((aud) => aud === expected)
  }
  return false
}

async function getJwks(jwksUrl: string, forceRefresh = false): Promise<Jwk[]> {
  const cached = jwksCache.get(jwksUrl)
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.keys
  }

  const response = await fetch(jwksUrl)
  if (!response.ok) {
    throw new Error(`Access JWKS request failed: ${response.status}`)
  }

  const body = (await response.json()) as JwksResponse
  if (!Array.isArray(body.keys)) {
    throw new Error('Access JWKS response is invalid')
  }

  jwksCache.set(jwksUrl, {
    keys: body.keys,
    expiresAt: Date.now() + JWKS_CACHE_TTL_MS,
  })
  return body.keys
}

async function verifyRs256(
  signingInput: string,
  signature: Uint8Array,
  jwk: Jwk,
): Promise<boolean> {
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return false

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['verify'],
  )

  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    new TextEncoder().encode(signingInput),
  )
}

/**
 * 驗證 Cloudflare Access 的 Cf-Access-Jwt-Assertion，並回傳 JWT 的 common_name。
 * 驗證包含：簽章、issuer、audience、nbf、exp。
 */
export async function verifyAccessAssertion(
  env: Pick<Env, 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD'>,
  assertion: string,
): Promise<string | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    console.error('[auth] 缺少環境變數 ACCESS_TEAM_DOMAIN 或 ACCESS_AUD')
    return null
  }

  const teamDomain = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const issuer = `https://${teamDomain}`
  const jwksUrl = `${issuer}/cdn-cgi/access/certs`
  const parts = assertion.split('.')

  if (parts.length !== 3) return null

  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const header = decodeJson<JwtHeader>(encodedHeader)
  const payload = decodeJson<JwtPayload>(encodedPayload)

  if (!header || !payload || header.alg !== 'RS256' || !header.kid) {
    return null
  }

  if (payload.iss !== issuer || !hasAudience(payload, env.ACCESS_AUD)) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null
  if (typeof payload.nbf === 'number' && payload.nbf > now) return null

  try {
    let keys = await getJwks(jwksUrl)
    let jwk = keys.find((key) => key.kid === header.kid)

    // Key rotation 時，cache 裡可能沒有新 key；強制重新抓一次。
    if (!jwk) {
      keys = await getJwks(jwksUrl, true)
      jwk = keys.find((key) => key.kid === header.kid)
    }

    if (!jwk) return null

    const valid = await verifyRs256(
      `${encodedHeader}.${encodedPayload}`,
      base64UrlDecode(encodedSignature),
      jwk,
    )

    if (!valid) return null

    if (typeof payload.common_name !== 'string' || !payload.common_name) {
      return null
    }

    return payload.common_name
  } catch (error) {
    console.error('[auth] Access JWT 驗證失敗', error)
    return null
  }
}


/**
 * 解析 SERVICE_IDENTITY_MAP（JSON 字串：common_name → email）。
 */
export function resolveEmailByCommonName(
  serviceIdentityMap: string | undefined,
  commonName: string,
): string | null {
  if (!serviceIdentityMap) {
    console.error('[auth] 缺少環境變數 SERVICE_IDENTITY_MAP')
    return null
  }

  let identityMap: Record<string, unknown>
  try {
    identityMap = JSON.parse(serviceIdentityMap) as Record<string, unknown>
  } catch {
    console.error('[auth] SERVICE_IDENTITY_MAP 不是合法 JSON')
    return null
  }

  const email = identityMap[commonName]
  return typeof email === 'string' && email ? email : null
}
