import { Notice, TFile, normalizePath } from 'obsidian';
import type VaultSyncPlugin from '../main';
import { ensureVaultResolved, VaultNotConfiguredError } from './vaultResolve';
import { downloadObject, postSync, uploadObject, type ApiCredentials } from './api';
import { sha256Hex } from './hash';
import type { FilePayload, PullEvent, PushCommand, SyncQueueItem, SyncResponseBody } from '../types';

/** 每批最多取佇列裡最舊的 50 筆，避免單次請求過大。 */
const BATCH_SIZE = 50;

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * 讀檔、算 hash、上傳內容，組出這一批的 PushCommand[]。
 *
 * 若某個非刪除項目在本地已經找不到檔案（debounce 結束後、真正同步前又被
 * 刪除），略過它的上傳，留在佇列裡等下一次相關事件把它合併成正確狀態。
 *
 * 上傳過程中若 API 呼叫失敗，直接把例外往外丟中止整批同步；已經上傳成功的
 * 內容是安全的，下次同步重新走一次即可恢復。
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
		if (item.entityType === 'VAULT') {
			commands.push({
				mutationId: item.mutationId,
				entityType: 'VAULT',
				vaultId: item.vaultId,
				entityId: item.entityId,
				baseVersion: item.baseVersion,
				payload: JSON.stringify(item.payload),
			});
			console.log(`[vault-sync] VAULT create  ${item.entityId}（mutationId=${item.mutationId}）`);
			continue;
		}

		if (item.payload.isDeleted) {
			const payload: FilePayload = { contentHash: null, isDeleted: true };
			commands.push({
				mutationId: item.mutationId,
				entityType: item.entityType,
				vaultId: item.vaultId,
				entityId: item.entityId,
				baseVersion: item.baseVersion,
				payload: JSON.stringify(payload),
			});
			console.log(`[vault-sync] DELETE  ${item.entityId}（mutationId=${item.mutationId}）`);
			continue;
		}

		const path = normalizePath(item.entityId);
		const file = vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			console.warn(`[vault-sync] 本地檔案 ${item.entityId} 已不存在，這次同步先略過它的上傳`);
			continue;
		}

		const content = await vault.readBinary(file);
		const contentHash = await sha256Hex(content);
		console.log(
			`[vault-sync] 上傳中 ${item.entityId}（${content.byteLength} bytes，hash=${contentHash.slice(0, 8)}…）`,
		);
		await uploadObject(creds, vaultId, contentHash, content);
		const payload: FilePayload = { contentHash, isDeleted: false };
		commands.push({
			mutationId: item.mutationId,
			entityType: item.entityType,
			vaultId: item.vaultId,
			entityId: item.entityId,
			baseVersion: item.baseVersion,
			payload: JSON.stringify(payload),
		});
	}

	console.log(`[vault-sync] 這一批內容上傳完成，共組出 ${commands.length} 筆 pushCommand`);
	return commands;
}

async function applyPullEvent(
	plugin: VaultSyncPlugin,
	creds: ApiCredentials,
	vaultId: string,
	event: PullEvent,
): Promise<void> {
	const { vault } = plugin.app;
	const path = normalizePath(event.entityId);

	// payload === null 視同刪除（防呆）；entityType='FILE' 理論上不會是 null。
	const payload: FilePayload | null = event.payload ? (JSON.parse(event.payload) as FilePayload) : null;

	if (!payload || payload.isDeleted) {
		const file = vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			console.log(`[vault-sync] pull DELETE ${path}（version=${event.version}），本地檔案已移至回收桶`);
			await plugin.app.fileManager.trashFile(file);
		} else {
			console.log(`[vault-sync] pull DELETE ${path}（version=${event.version}），本地本來就沒有這個檔案`);
		}
		return;
	}

	if (!payload.contentHash) {
		throw new Error(`pullEvent（mutationId=${event.mutationId}）isDeleted=false 但缺少 contentHash`);
	}
	console.log(
		`[vault-sync] 下載中 ${path}（version=${event.version}，hash=${payload.contentHash.slice(0, 8)}…）`,
	);
	const content = await downloadObject(creds, vaultId, payload.contentHash);
	if (content === null) {
		throw new Error(`contentHash ${payload.contentHash} 在伺服器端找不到（404）`);
	}

	const existing = vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await vault.modifyBinary(existing, content);
		console.log(`[vault-sync] pull 完成，已覆寫既有檔案 ${path}`);
		return;
	}

	const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	if (parentPath && !vault.getAbstractFileByPath(parentPath)) {
		await vault.createFolder(parentPath).catch(() => {
			// 可能是併發建立或已存在，忽略即可，createBinary 會再驗證一次路徑。
		});
	}
	await vault.createBinary(path, content);
	console.log(`[vault-sync] pull 完成，已新增檔案 ${path}`);
}

async function applyBatchResponse(
	plugin: VaultSyncPlugin,
	creds: ApiCredentials,
	vaultId: string,
	batch: SyncQueueItem[],
	response: SyncResponseBody,
): Promise<{
	ok: number;
	skipped: number;
	error: number;
	pulled: number;
	erroredPaths: string[];
	vaultCreateFailed: boolean;
}> {
	const state = plugin.getOrCreateVaultState(vaultId);
	const mutationMap = new Map(batch.map((item) => [item.mutationId, item]));

	// 記錄本次被 pull 覆蓋到的路徑，供下面判斷 ERROR 要不要保留使用。
	const pullPaths = new Set<string>();
	let pulled = 0;
	if (response.pullEvents.length === 0) {
		console.log('[vault-sync] pullEvents 是空的，沒有新的伺服器端事件');
	} else {
		console.log(`[vault-sync] 收到 ${response.pullEvents.length} 筆 pullEvents，套用中...`);
	}
	for (const event of response.pullEvents) {
		// pull 現在是使用者層級的，會混進別的 vault 的事件、以及不代表檔案
		// 內容變化的 VAULT 事件；用 entityId 當 key 的 pullPaths/fileVersions
		// 只能收本次真正屬於這個 vault 的 FILE 事件，不然不同 vault 剛好同名
		// 的路徑會互相污染彼此的版本紀錄。
		if (event.vaultId !== vaultId || event.entityType !== 'FILE') {
			continue;
		}
		pullPaths.add(normalizePath(event.entityId));
		try {
			await applyPullEvent(plugin, creds, vaultId, event);
			const payload = event.payload ? (JSON.parse(event.payload) as { isDeleted: boolean }) : null;
			if (!payload || payload.isDeleted) {
				delete state.fileVersions[event.entityId];
			} else {
				state.fileVersions[event.entityId] = event.version;
			}
			pulled++;
		} catch (err) {
			console.error(`[vault-sync] 套用 pullEvent 失敗（path=${event.entityId}）`, err);
		}
	}

	// cursor 是使用者層級的，即使這批 pullEvents 大多不屬於這個 vault，還是
	// 整批往前推進，下次同步才不會重複掃到已經看過、但跟自己無關的事件。
	plugin.settings.globalSyncCursor = response.newCursor;

	// OK/SKIPPED 移除該列；ERROR 但路徑剛好被本次 pull 覆蓋掉的話，代表本地已經
	// 被伺服器版本蓋過，一併清除；其餘 ERROR 留在佇列裡等下次同步重試。
	let ok = 0;
	let skipped = 0;
	let error = 0;
	let vaultCreateFailed = false;
	const removedMutationIds = new Set<string>();
	const erroredPaths: string[] = [];

	for (const result of response.pushResults) {
		const entry = mutationMap.get(result.mutationId);
		if (!entry) continue;

		if (entry.entityType === 'VAULT') {
			removedMutationIds.add(result.mutationId);
			if (result.status === 'ERROR') {
				error++;
				vaultCreateFailed = true;
				console.warn(`[vault-sync] ERROR    VAULT ${entry.entityId}（mutationId=${result.mutationId}）`);
				// 撞名不自動重試：清掉快取，等使用者手動改名字，下次同步才會
				// 重新產生候選 UUID。
				plugin.settings.resolvedVaultId = null;
				plugin.settings.resolvedVaultName = null;
				new Notice(`Vault Sync：vault 名稱「${entry.entityId}」已被使用，請改個名字後再同步一次。`);
			} else if (result.status === 'SKIPPED') {
				skipped++;
				console.log(`[vault-sync] SKIPPED  VAULT ${entry.entityId}（mutationId=${result.mutationId}）`);
			} else {
				ok++;
				console.log(`[vault-sync] OK       VAULT ${entry.entityId}（mutationId=${result.mutationId}）`);
			}
			continue;
		}

		if (result.status === 'OK') {
			ok++;
			removedMutationIds.add(result.mutationId);
			console.log(`[vault-sync] OK       ${entry.entityId}（mutationId=${result.mutationId}）`);
			if (entry.payload.isDeleted) {
				delete state.fileVersions[entry.entityId];
			} else {
				// 樂觀更新：對齊伺服器端 baseVersion+1 的版本號算法。
				state.fileVersions[entry.entityId] = entry.baseVersion + 1;
			}
		} else if (result.status === 'SKIPPED') {
			skipped++;
			removedMutationIds.add(result.mutationId);
			console.log(`[vault-sync] SKIPPED  ${entry.entityId}（mutationId=${result.mutationId}）`);
		} else {
			error++;
			console.warn(`[vault-sync] ERROR    ${entry.entityId}（mutationId=${result.mutationId}）`);
			if (pullPaths.has(normalizePath(entry.entityId))) {
				removedMutationIds.add(result.mutationId);
			} else {
				erroredPaths.push(entry.entityId);
			}
		}
	}

	state.syncQueue = state.syncQueue.filter((item) => {
		if (removedMutationIds.has(item.mutationId)) return false;
		// 防呆：即使不在這一批 pushResults 裡，只要路徑被本次 pull 覆蓋就清掉殘留列。
		if (item.entityType === 'FILE' && pullPaths.has(normalizePath(item.entityId))) return false;
		return true;
	});

	return { ok, skipped, error, pulled, erroredPaths, vaultCreateFailed };
}

export async function runSync(plugin: VaultSyncPlugin): Promise<void> {
	console.log('[vault-sync] === 開始同步 ===');
	plugin.queueManager.flushAll();

	let vaultId: string;
	try {
		vaultId = await ensureVaultResolved(plugin);
		console.log(`[vault-sync] vaultId 已解析：${vaultId}`);
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

	let batchNo = 0;
	for (;;) {
		batchNo++;
		// 出列順序即陣列順序：合併同一個 entityId 的後續事件是 in-place 更新，
		// 不會把項目搬到佇列尾端，陣列順序本身就是先進先出。
		const batch = state.syncQueue.slice(0, BATCH_SIZE);
		const isFullBatch = batch.length === BATCH_SIZE;

		if (batch.length === 0) {
			console.log(`[vault-sync] 第 ${batchNo} 批：佇列是空的，仍會送出請求以確認是否有新的 pullEvents`);
		} else {
			console.log(`[vault-sync] 第 ${batchNo} 批，共 ${batch.length} 筆待推送（單批上限 ${BATCH_SIZE}）`);
		}

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
			console.log(
				`[vault-sync] POST /sync 送出中（lastCursor=${plugin.settings.globalSyncCursor}，pushCommands=${pushCommands.length} 筆）`,
			);
			response = await postSync(creds, { lastCursor: plugin.settings.globalSyncCursor, pushCommands });
			console.log(
				`[vault-sync] POST /sync 收到回應（newCursor=${response.newCursor}，pushResults=${response.pushResults.length} 筆，pullEvents=${response.pullEvents.length} 筆）`,
			);
		} catch (err) {
			new Notice(
				`Vault Sync：同步請求失敗，已中止本次同步，佇列保留供下次重試（${describeError(err)}）。`,
			);
			await plugin.saveSettings();
			return;
		}

		const batchResult = await applyBatchResponse(plugin, creds, vaultId, batch, response);
		totals.ok += batchResult.ok;
		totals.skipped += batchResult.skipped;
		totals.error += batchResult.error;
		totals.pulled += batchResult.pulled;
		allErroredPaths.push(...batchResult.erroredPaths);

		await plugin.saveSettings();

		console.log(
			`[vault-sync] 第 ${batchNo} 批完成 — OK: ${batchResult.ok}, SKIPPED: ${batchResult.skipped}, ERROR: ${batchResult.error}, pulled: ${batchResult.pulled}`,
		);

		// vault 建立本身撞名失敗時，這個 vaultId 永遠不會存在，佇列裡剩下的
		// FILE command 全部只會繼續 ERROR，沒有必要再送更多批次浪費請求。
		if (batchResult.vaultCreateFailed) break;

		if (!isFullBatch) break;
	}

	console.log(
		`[vault-sync] === 同步結束 — 共 ${batchNo} 批 — OK: ${totals.ok}, SKIPPED: ${totals.skipped}, ERROR: ${totals.error}, 拉取: ${totals.pulled} 筆 ===`,
	);
	const summary = `Vault Sync 完成 — 推送 OK ${totals.ok}／SKIPPED ${totals.skipped}／ERROR ${totals.error}，拉取 ${totals.pulled} 筆事件。`;
	new Notice(summary);
	if (allErroredPaths.length > 0) {
		new Notice(
			`Vault Sync：以下檔案同步失敗，將保留在佇列中等下次同步重試：\n${allErroredPaths.join('\n')}`,
		);
	}
}
