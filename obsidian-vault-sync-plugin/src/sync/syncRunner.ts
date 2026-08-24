import { Notice, TFile, normalizePath } from 'obsidian';
import type VaultSyncPlugin from '../main';
import { ensureVaultResolved, VaultNotConfiguredError } from './vaultResolve';
import {
	downloadObject,
	postSync,
	uploadObject,
	VaultForbiddenError,
	type ApiCredentials,
} from './api';
import { sha256Hex } from './hash';
import type { PullEvent, PushCommand, SyncQueueItem, SyncResponseBody } from '../types';

/** Client-規格書第 8.2 節：每批最多取佇列裡最舊的 50 筆。 */
const BATCH_SIZE = 50;

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * 讀檔、算 hash、上傳內容（第 8.1 節），並組出這一批的 `PushCommand[]`（第 8.2 節）。
 *
 * 若批次中某個 `action = CREATE/MODIFY` 的檔案在本地已經找不到了（debounce 結束後、
 * 真正同步前又被刪除，理論上少見），略過這筆上傳、也不放進 `pushCommands`；它會繼續
 * 留在佇列裡，等下一次相關的 vault 事件（多半是 DELETE）把它合併成正確的動作。
 * 這個情境規格書沒有明講，屬於實作補充。
 *
 * 上傳過程中若真正的 API 呼叫失敗（網路、伺服器錯誤等），直接把例外往外丟，交給
 * `runSync` 中止整批同步——已經上傳成功的內容是安全的（見規格書第 9 節：內容上傳
 * 成功但 metadata 沒送出時，下次同步重新走 8.1～8.2 即可安全恢復）。
 */
async function buildPushCommands(
	plugin: VaultSyncPlugin,
	creds: ApiCredentials,
	vaultId: string,
	batch: SyncQueueItem[],
): Promise<PushCommand[]> {
	const { vault } = plugin.app;
	const commands: PushCommand[] = [];

	for (const item of batch) {
		if (item.action === 'DELETE') {
			commands.push({
				mutationId: item.mutationId,
				path: item.path,
				action: item.action,
				baseVersion: item.baseVersion,
			});
			continue;
		}

		const path = normalizePath(item.path);
		const file = vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			console.warn(`[vault-sync] 本地檔案 ${item.path} 已不存在，這次同步先略過它的上傳`);
			continue;
		}

		const content = await vault.readBinary(file);
		const contentHash = await sha256Hex(content);
		await uploadObject(creds, vaultId, contentHash, content);
		commands.push({
			mutationId: item.mutationId,
			path: item.path,
			action: item.action,
			baseVersion: item.baseVersion,
			contentHash,
		});
	}

	return commands;
}

/** Client-規格書第 8.4 節：依序套用 pullEvents。 */
async function applyPullEvent(
	plugin: VaultSyncPlugin,
	creds: ApiCredentials,
	vaultId: string,
	event: PullEvent,
): Promise<void> {
	const { vault } = plugin.app;
	const path = normalizePath(event.path);

	if (event.action === 'DELETE') {
		const file = vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await plugin.app.fileManager.trashFile(file);
		}
		return;
	}

	if (!event.contentHash) {
		throw new Error(`pullEvent（mutationId=${event.mutationId}）action=${event.action} 但缺少 contentHash`);
	}
	const content = await downloadObject(creds, vaultId, event.contentHash);
	if (content === null) {
		throw new Error(`contentHash ${event.contentHash} 在伺服器端找不到（404）`);
	}

	const existing = vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await vault.modifyBinary(existing, content);
		return;
	}

	const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	if (parentPath && !vault.getAbstractFileByPath(parentPath)) {
		await vault.createFolder(parentPath).catch(() => {
			// 可能是併發建立或已存在，忽略即可，createBinary 會再驗證一次路徑。
		});
	}
	await vault.createBinary(path, content);
}

/**
 * 處理單一批次收到的 `SyncResponseBody`：套用 pullEvents、依第 8.3 節與第 9.1 節
 * 決議處理 pushResults，並清理本地佇列與版本快取。回傳這一批的統計數字。
 */
async function applyBatchResponse(
	plugin: VaultSyncPlugin,
	creds: ApiCredentials,
	vaultId: string,
	batch: SyncQueueItem[],
	response: SyncResponseBody,
): Promise<{ ok: number; skipped: number; error: number; pulled: number; erroredPaths: string[] }> {
	const state = plugin.getOrCreateVaultState(vaultId);
	const mutationMap = new Map(batch.map((item) => [item.mutationId, item]));

	// 8.4 套用 pullEvents，同時記錄這次被覆蓋到的路徑，供下面第 9.1 節決議使用。
	const pullPaths = new Set<string>();
	let pulled = 0;
	for (const event of response.pullEvents) {
		pullPaths.add(normalizePath(event.path));
		try {
			await applyPullEvent(plugin, creds, vaultId, event);
			if (event.action === 'DELETE') {
				delete state.fileVersions[event.path];
			} else {
				state.fileVersions[event.path] = event.version;
			}
			pulled++;
		} catch (err) {
			console.error(`[vault-sync] 套用 pullEvent 失敗（path=${event.path}）`, err);
		}
	}

	// 8.5：套用完 pullEvents 後才寫回 lastCursor。
	state.lastCursor = response.newCursor;

	// 8.3 + 第 9.1 節決議：OK/SKIPPED 移除該列；ERROR 時，若這個路徑剛好被本次
	// pullEvents 覆蓋掉，代表本地檔案已經被伺服器端的版本蓋過，一併清除、不用管；
	// 其餘 ERROR 保留在佇列裡等下次同步重試，並在最後彙整成 Notice 提示使用者。
	let ok = 0;
	let skipped = 0;
	let error = 0;
	const removedMutationIds = new Set<string>();
	const erroredPaths: string[] = [];

	for (const result of response.pushResults) {
		const entry = mutationMap.get(result.mutationId);
		if (!entry) continue;

		if (result.status === 'OK') {
			ok++;
			removedMutationIds.add(result.mutationId);
			if (entry.action === 'DELETE') {
				delete state.fileVersions[entry.path];
			} else {
				// 本地樂觀更新：與伺服器 baseVersion+1 的算法對齊（見 types.ts 對
				// fileVersions 的說明）。
				state.fileVersions[entry.path] = entry.baseVersion + 1;
			}
		} else if (result.status === 'SKIPPED') {
			skipped++;
			removedMutationIds.add(result.mutationId);
		} else {
			error++;
			if (pullPaths.has(normalizePath(entry.path))) {
				removedMutationIds.add(result.mutationId);
			} else {
				erroredPaths.push(entry.path);
			}
		}
	}

	state.syncQueue = state.syncQueue.filter((item) => {
		if (removedMutationIds.has(item.mutationId)) return false;
		// 防呆：即使不在這一批 pushResults 裡，只要路徑被本次 pull 覆蓋就清掉殘留列。
		if (pullPaths.has(normalizePath(item.path))) return false;
		return true;
	});

	return { ok, skipped, error, pulled, erroredPaths };
}

/** Client-規格書第 6～8 節：手動觸發同步的完整流程。 */
export async function runSync(plugin: VaultSyncPlugin): Promise<void> {
	// 第 6 節：處理流程開始前，先強制結束所有還在計時中的 debounce。
	plugin.queueManager.flushAll();

	let vaultId: string;
	try {
		vaultId = await ensureVaultResolved(plugin);
	} catch (err) {
		if (err instanceof VaultNotConfiguredError) {
			new Notice('Vault Sync：請先在設定畫面填入 API base URL、Access 憑證與 Vault 名稱。');
		} else {
			new Notice(`Vault Sync：初始化 vault 失敗，已中止本次同步（${describeError(err)}）。`);
		}
		return;
	}

	const state = plugin.getOrCreateVaultState(vaultId);
	const creds: ApiCredentials = {
		apiBaseUrl: plugin.settings.apiBaseUrl,
		accessClientId: plugin.settings.accessClientId,
		accessClientSecret: plugin.settings.accessClientSecret,
	};

	const totals = { ok: 0, skipped: 0, error: 0, pulled: 0 };
	const allErroredPaths: string[] = [];

	for (;;) {
		const sorted = [...state.syncQueue].sort((a, b) => a.updatedAt - b.updatedAt);
		const batch = sorted.slice(0, BATCH_SIZE);
		const isFullBatch = batch.length === BATCH_SIZE;

		let pushCommands: PushCommand[];
		try {
			pushCommands = await buildPushCommands(plugin, creds, vaultId, batch);
		} catch (err) {
			new Notice(
				`Vault Sync：上傳內容失敗，已中止本次同步，佇列保留供下次重試（${describeError(err)}）。`,
			);
			await plugin.saveSettings();
			return;
		}

		let response: SyncResponseBody;
		try {
			response = await postSync(creds, vaultId, { lastCursor: state.lastCursor, pushCommands });
		} catch (err) {
			if (err instanceof VaultForbiddenError) {
				// 第 9.2 節決議：清空本地快取的 vaultId 綁定，強制下次走第 5 節重新解析。
				plugin.settings.resolvedVaultId = null;
				plugin.settings.resolvedVaultName = null;
				await plugin.saveSettings();
				new Notice('Vault Sync：這個 vault 綁定已失效，已重新綁定，請重新執行一次同步。');
			} else {
				new Notice(
					`Vault Sync：同步請求失敗，已中止本次同步，佇列保留供下次重試（${describeError(err)}）。`,
				);
				await plugin.saveSettings();
			}
			return;
		}

		const batchResult = await applyBatchResponse(plugin, creds, vaultId, batch, response);
		totals.ok += batchResult.ok;
		totals.skipped += batchResult.skipped;
		totals.error += batchResult.error;
		totals.pulled += batchResult.pulled;
		allErroredPaths.push(...batchResult.erroredPaths);

		await plugin.saveSettings();

		if (!isFullBatch) break;
	}

	const summary = `Vault Sync 完成 — 推送 OK ${totals.ok}／SKIPPED ${totals.skipped}／ERROR ${totals.error}，拉取 ${totals.pulled} 筆事件。`;
	new Notice(summary);
	if (allErroredPaths.length > 0) {
		new Notice(
			`Vault Sync：以下檔案同步失敗，將保留在佇列中等下次同步重試：\n${allErroredPaths.join('\n')}`,
		);
	}
}
