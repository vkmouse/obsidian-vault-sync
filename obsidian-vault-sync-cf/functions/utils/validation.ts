/**
 * 驗證 vault 名稱：1–100 字元，不限制字元種類（中文、emoji、符號皆可）。
 * 刻意不做 trim——是否要去除頭尾空白是使用者的選擇，擅自處理可能讓
 * 使用者存的名稱跟他實際輸入的不一樣。
 */
export function validateVaultName(name: unknown): string | null {
  if (typeof name !== 'string') {
    return null
  }
  if (name.length < 1 || name.length > 100) {
    return null
  }
  return name
}
