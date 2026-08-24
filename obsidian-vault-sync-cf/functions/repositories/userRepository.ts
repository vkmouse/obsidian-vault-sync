/**
 * 依 email 查詢或建立使用者，取得內部 userId。第一次用某個 email 發出請求
 * 時自動建立記錄，之後同一個 email 一律沿用同一筆，不需要額外的註冊端點。
 */
export async function findOrCreateUserId(db: D1Database, email: string): Promise<string> {
  // 先產生候選 UUID 再交給 INSERT 判斷是否要用：若 email 已存在，
  // 這個值會被捨棄，避免多一次「查完再建」的往返。
  const candidateId = crypto.randomUUID()

  const inserted = await db
    .prepare(
      `INSERT INTO users (id, email) VALUES (?, ?)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
    )
    .bind(candidateId, email)
    .first<{ id: string }>()

  if (inserted) {
    return inserted.id
  }

  const existing = await db
    .prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>()

  if (!existing) {
    // 理論上不會發生，出現代表資料庫狀態跟預期不一致，中止比靜默用一個
    // 沒有實際對應記錄的 id 繼續執行更安全。
    throw new Error(`[auth] 無法解析 userId：email=${email}`)
  }

  return existing.id
}
