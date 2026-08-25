import type { DataAdapter } from 'obsidian';

/** 用 adapter 而非 vault API 遞迴列出所有檔案：後者看不到 .obsidian 等點資料夾，前者可以。 */
export async function listAllFiles(adapter: DataAdapter, dir = ''): Promise<string[]> {
	const { files, folders } = await adapter.list(dir);
	const nested = await Promise.all(folders.map((folder) => listAllFiles(adapter, folder)));
	return [...files, ...nested.flat()];
}
