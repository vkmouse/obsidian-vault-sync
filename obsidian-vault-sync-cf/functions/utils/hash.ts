/**
 * 輸出固定為小寫十六進位字串，跟呼叫端傳來的 contentHash 做字串比對時
 * 大小寫不一致就會判定為不符，不需要額外 normalize 任何一邊。
 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
