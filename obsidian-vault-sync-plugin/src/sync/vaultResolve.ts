import { createOrResolveVault } from './api';
import type { ApiCredentials } from './api';
import type VaultSyncPlugin from '../main';

export class VaultNotConfiguredError extends Error {
	constructor() {
		super('尚未在設定畫面填入 Vault 名稱與 API 憑證');
		this.name = 'VaultNotConfiguredError';
	}
}

/**
 * Client-規格書第 5 節：確認 `vaultName` 已經換到一個可用的 `vaultId`。
 * 回傳可直接用於第 7 節端點的 `vaultId`。
 */
export async function ensureVaultResolved(plugin: VaultSyncPlugin): Promise<string> {
	const { settings } = plugin;

	if (!settings.apiBaseUrl || !settings.accessClientId || !settings.accessClientSecret || !settings.vaultName) {
		throw new VaultNotConfiguredError();
	}

	// 第 1 步：比對 vaultName 是否等於 resolvedVaultName。
	if (settings.vaultName === settings.resolvedVaultName && settings.resolvedVaultId) {
		console.log(`[vault-sync] vaultId 沿用本地快取：${settings.resolvedVaultId}（name=${settings.vaultName}）`);
		return settings.resolvedVaultId;
	}

	// 第 2 步：重新解析。
	console.log(`[vault-sync] 本地快取的 vaultId 無效或名稱已變更，重新向伺服器解析 name=${settings.vaultName}`);
	const creds: ApiCredentials = {
		apiBaseUrl: settings.apiBaseUrl,
		accessClientId: settings.accessClientId,
		accessClientSecret: settings.accessClientSecret,
	};
	const result = await createOrResolveVault(creds, settings.vaultName);
	console.log(`[vault-sync] 解析完成：vaultId=${result.vaultId}，status=${result.status}`);

	settings.resolvedVaultId = result.vaultId;
	settings.resolvedVaultName = settings.vaultName;
	// 若本地 vaults 底下還沒有這個 vaultId 的記錄，建立空的 VaultLocalState；
	// 已經有記錄（改名又改回原本的名稱）則保留既有進度，不覆蓋。
	plugin.getOrCreateVaultState(result.vaultId);
	await plugin.saveSettings();

	return result.vaultId;
}
