import { createOrResolveVault } from './api';
import type { ApiCredentials } from './api';
import type VaultSyncPlugin from '../main';

export class VaultNotConfiguredError extends Error {
	constructor() {
		super('尚未在設定畫面填入 Vault 名稱與 API 憑證');
		this.name = 'VaultNotConfiguredError';
	}
}

export async function ensureVaultResolved(plugin: VaultSyncPlugin): Promise<string> {
	const { settings } = plugin;

	if (!settings.apiBaseUrl || !settings.accessClientId || !settings.accessClientSecret || !settings.vaultName) {
		throw new VaultNotConfiguredError();
	}

	if (settings.vaultName === settings.resolvedVaultName && settings.resolvedVaultId) {
		console.log(`[vault-sync] vaultId 沿用本地快取：${settings.resolvedVaultId}（name=${settings.vaultName}）`);
		return settings.resolvedVaultId;
	}

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
	// 改名又改回原本名稱時，這個 vaultId 可能已有進度，不能用空狀態覆蓋掉。
	plugin.getOrCreateVaultState(result.vaultId);
	await plugin.saveSettings();

	return result.vaultId;
}
