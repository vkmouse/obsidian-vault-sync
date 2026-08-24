/**
 * 解析 SERVICE_TOKEN_MAP 環境變數（JSON 字串：clientId → email），
 * 依 clientId 查出對應的 email。環境變數缺失、不是合法 JSON、或查無
 * 對應的 clientId 都一律回傳 null，不細分錯誤原因，讓呼叫端自行決定
 * 要怎麼回應——這個函式只負責「查得到 / 查不到」。
 */
export function resolveEmailByClientId(
  serviceTokenMap: string | undefined,
  clientId: string,
): string | null {
  if (!serviceTokenMap) {
    console.error('[auth] 缺少環境變數 SERVICE_TOKEN_MAP')
    return null
  }

  let tokenMap: Record<string, unknown>
  try {
    tokenMap = JSON.parse(serviceTokenMap)
  } catch {
    console.error('[auth] SERVICE_TOKEN_MAP 不是合法 JSON')
    return null
  }

  const email = tokenMap[clientId]
  return typeof email === 'string' && email ? email : null
}
