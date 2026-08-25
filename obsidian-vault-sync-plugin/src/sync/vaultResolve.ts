import { postResolveVault } from './api';
import type VaultSyncPlugin from '../main';

export class VaultNotConfiguredError extends Error {
	constructor() {
		super('尚未在設定畫面填入 Vault 名稱與 API 憑證');
		this.name = 'VaultNotConfiguredError';
	}
}

/**
 * 沿用本地快取的前提是名稱沒變；名稱變更一律重新呼叫 resolve API 換一個
 * vaultId，因為新舊 vaultId 對應的是完全不同的鏡像目標，不能延用。
 */
export async function ensureVaultResolved(plugin: VaultSyncPlugin): Promise<string> {
	const { settings } = plugin;

	if (!settings.apiBaseUrl || !settings.accessClientId || !settings.accessClientSecret || !settings.vaultName) {
		throw new VaultNotConfiguredError();
	}

	if (settings.vaultName === settings.resolvedVaultName && settings.resolvedVaultId) {
		return settings.resolvedVaultId;
	}

	const candidateId = crypto.randomUUID();
	const { vaultId } = await postResolveVault(
		{
			apiBaseUrl: settings.apiBaseUrl,
			accessClientId: settings.accessClientId,
			accessClientSecret: settings.accessClientSecret,
		},
		settings.vaultName,
		candidateId,
	);

	settings.resolvedVaultId = vaultId;
	settings.resolvedVaultName = settings.vaultName;
	// 換了 vaultId 等於換了整個鏡像目標，舊的「已知遠端狀態」清單不再有意義。
	settings.remoteManifest = [];
	await plugin.saveSettings();

	return vaultId;
}
