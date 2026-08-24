export interface FileRow {
  vault_id: string
  path: string
  version: number
  content_hash: string | null
  is_deleted: number
  updated_at: string
}

export interface FileColumns {
  contentHash: string | null
  isDeleted: boolean
}

/** path 已存在時不寫入，回傳 null。 */
export async function insert(
  db: D1Database,
  vaultId: string,
  path: string,
  payload: FileColumns,
): Promise<FileRow | null> {
  return db
    .prepare(
      `INSERT INTO files (vault_id, path, version, content_hash, is_deleted)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT (vault_id, path) DO NOTHING
       RETURNING *`,
    )
    .bind(vaultId, path, payload.contentHash, payload.isDeleted ? 1 : 0)
    .first<FileRow>()
}

/**
 * content_hash 跟 is_deleted 一次寫入同一句 UPDATE：刪除只是這次覆寫
 * 剛好把 is_deleted 設成 1，不是另一條 SQL 路徑。
 */
export async function update(
  db: D1Database,
  vaultId: string,
  path: string,
  baseVersion: number,
  payload: FileColumns,
): Promise<FileRow | null> {
  const newVersion = baseVersion + 1
  return db
    .prepare(
      `UPDATE files
       SET content_hash = ?, is_deleted = ?, version = ?, updated_at = CURRENT_TIMESTAMP
       WHERE vault_id = ?
         AND path = ?
         AND version = ?
       RETURNING *`,
    )
    .bind(payload.contentHash, payload.isDeleted ? 1 : 0, newVersion, vaultId, path, baseVersion)
    .first<FileRow>()
}
