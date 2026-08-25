import { Notice } from 'obsidian';
import type VaultSyncPlugin from '../main';
import { ensureVaultResolved, VaultNotConfiguredError } from './vaultResolve';
import { downloadVaultBlob, uploadVaultBlob, type ApiCredentials } from './api';
import { packZip, unpackZip, toArrayBuffer } from './zip';
import { listAllFiles } from './vaultFiles';
import { computeDiff } from './diff';
import { ConfirmSyncModal } from './confirmModal';

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function credsOf(plugin: VaultSyncPlugin): ApiCredentials {
	return {
		apiBaseUrl: plugin.settings.apiBaseUrl,
		accessClientId: plugin.settings.accessClientId,
		accessClientSecret: plugin.settings.accessClientSecret,
	};
}

/** push/pull 共用的前置步驟；失敗時已經自己跳過 Notice，呼叫端只需要中止。 */
async function resolveVaultOrNotify(plugin: VaultSyncPlugin): Promise<string | null> {
	try {
		return await ensureVaultResolved(plugin);
	} catch (err) {
		if (err instanceof VaultNotConfiguredError) {
			new Notice('Vault Sync：請先在設定畫面填入 API base URL、Access 憑證與 Vault 名稱。');
		} else {
			new Notice(`Vault Sync：初始化 vault 失敗，已中止（${describeError(err)}）。`);
		}
		return null;
	}
}

async function ensureParentFolderExists(plugin: VaultSyncPlugin, path: string): Promise<void> {
	const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	if (!parent) return;
	const { adapter } = plugin.app.vault;
	if (!(await adapter.exists(parent))) {
		// 併發建立或已存在都當作成功，寫入本身會再驗證一次路徑。
		await adapter.mkdir(parent).catch(() => {});
	}
}

export async function runPush(plugin: VaultSyncPlugin): Promise<void> {
	const vaultId = await resolveVaultOrNotify(plugin);
	if (!vaultId) return;

	const { adapter } = plugin.app.vault;
	const paths = await listAllFiles(adapter);
	const diff = computeDiff(plugin.settings.remoteManifest, paths);

	const confirmed = await ConfirmSyncModal.confirm(plugin.app, 'push', diff);
	if (!confirmed) return;

	const notice = new Notice('Vault Sync：push 同步中...', 0);
	try {
		// 打包當下不加鎖，直接讀取即時內容：單人 vault，併發寫入機率低，接受風險。
		const entries = await Promise.all(
			paths.map(async (path) => ({ path, data: new Uint8Array(await adapter.readBinary(path)) })),
		);
		const zipBytes = packZip(entries);
		await uploadVaultBlob(credsOf(plugin), vaultId, toArrayBuffer(zipBytes));

		plugin.settings.remoteManifest = paths;
		plugin.settings.lastPushedAt = new Date().toISOString();
		await plugin.saveSettings();
		new Notice(`Vault Sync：push 完成，共 ${paths.length} 個檔案。`);
	} catch (err) {
		new Notice(`Vault Sync：push 失敗，本地未受影響（${describeError(err)}）。`);
	} finally {
		notice.hide();
	}
}

export async function runPull(plugin: VaultSyncPlugin): Promise<void> {
	const vaultId = await resolveVaultOrNotify(plugin);
	if (!vaultId) return;

	const downloadNotice = new Notice('Vault Sync：下載中...', 0);
	let zipBytes: ArrayBuffer | null;
	try {
		zipBytes = await downloadVaultBlob(credsOf(plugin), vaultId);
	} catch (err) {
		new Notice(`Vault Sync：下載失敗，本地未受影響（${describeError(err)}）。`);
		return;
	} finally {
		downloadNotice.hide();
	}

	if (zipBytes === null) {
		new Notice('Vault Sync：遠端尚未有任何備份，請先 push 一次。');
		return;
	}

	// 下載到記憶體、尚未寫入 vault：使用者取消的話本地完全不受影響，
	// 等同規格書的「暫存資料夾」，只是不需要真的落地到磁碟。
	const remoteEntries = unpackZip(new Uint8Array(zipBytes));
	const remotePaths = remoteEntries.map((entry) => entry.path);
	const localPaths = await listAllFiles(plugin.app.vault.adapter);
	const diff = computeDiff(localPaths, remotePaths);

	const confirmed = await ConfirmSyncModal.confirm(plugin.app, 'pull', diff);
	if (!confirmed) return;

	const applyNotice = new Notice('Vault Sync：pull 套用中...', 0);
	try {
		const { adapter } = plugin.app.vault;
		for (const entry of remoteEntries) {
			await ensureParentFolderExists(plugin, entry.path);
			await adapter.writeBinary(entry.path, toArrayBuffer(entry.data));
		}

		// zip 沒有的本地檔案視為已被刪除：永久刪除，不進回收桶（已拍板的決策）。
		const remoteSet = new Set(remotePaths);
		for (const path of localPaths) {
			if (!remoteSet.has(path)) {
				await adapter.remove(path);
			}
		}

		plugin.settings.remoteManifest = remotePaths;
		plugin.settings.lastPulledAt = new Date().toISOString();
		await plugin.saveSettings();
		new Notice(`Vault Sync：pull 完成，共 ${remotePaths.length} 個檔案。`);
	} catch (err) {
		new Notice(`Vault Sync：pull 套用失敗，部分檔案可能已變更（${describeError(err)}）。`);
	} finally {
		applyNotice.hide();
	}
}
