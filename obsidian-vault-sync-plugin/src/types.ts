/** push 前 diff、pull 完覆寫用的「已知遠端狀態」清單：只存路徑，不存內容。 */
export type VaultManifest = string[];

/** 序列化進 Obsidian 的 data.json，是整個 plugin 唯一持久化的狀態。 */
export interface PluginData {
	accessClientId: string;
	accessClientSecret: string;
	/** Cloudflare Pages 專案的網域，例如 https://obsidian-vault-sync-cf.pages.dev（不含結尾斜線）。 */
	apiBaseUrl: string;
	vaultName: string;
	resolvedVaultId: string | null;
	resolvedVaultName: string | null;
	remoteManifest: VaultManifest;
	lastPushedAt: string | null;
	lastPulledAt: string | null;
}
