import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type VaultSyncPlugin from './main';
import type { PluginData } from './types';

export const DEFAULT_SETTINGS: PluginData = {
	accessClientId: '',
	accessClientSecret: '',
	apiBaseUrl: '',
	vaultName: '',
	resolvedVaultId: null,
	resolvedVaultName: null,
	globalSyncCursor: 0,
	vaults: {},
};

/** 需與後端的名稱長度限制一致，否則本地驗證通過但送出去仍會被拒。 */
export function isValidVaultName(name: string): boolean {
	return name.length >= 1 && name.length <= 100;
}

export class VaultSyncSettingTab extends PluginSettingTab {
	plugin: VaultSyncPlugin;

	constructor(app: App, plugin: VaultSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('API base URL')
			.setDesc('Cloudflare Pages 專案的網域，例如 https://obsidian-vault-sync-cf.pages.dev（結尾不要加斜線）。')
			.addText((text) =>
				text
					.setPlaceholder('https://your-project.pages.dev')
					.setValue(this.plugin.settings.apiBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiBaseUrl = value.trim().replace(/\/+$/, '');
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('CF-Access-Client-Id')
			.setDesc('Cloudflare Access Service Token 的 Client Id。')
			.addText((text) =>
				text
					.setPlaceholder('Client Id')
					.setValue(this.plugin.settings.accessClientId)
					.onChange(async (value) => {
						this.plugin.settings.accessClientId = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('CF-Access-Client-Secret')
			.setDesc('Cloudflare Access Service Token 的 Client Secret。同一組憑證可以裝在多台裝置上使用。')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('Client Secret')
					.setValue(this.plugin.settings.accessClientSecret)
					.onChange(async (value) => {
						this.plugin.settings.accessClientSecret = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Vault 名稱')
			.setDesc('人類可讀的名稱（1–100 字元），用來在伺服器端換到真正的 vaultId。改名後下次同步會自動重新解析。')
			.addText((text) =>
				text
					.setPlaceholder('例如：work、我的筆記')
					.setValue(this.plugin.settings.vaultName)
					.onChange(async (value) => {
						if (!isValidVaultName(value)) {
							new Notice('Vault 名稱長度必須介於 1 到 100 字元之間，未儲存這次修改。');
							text.setValue(this.plugin.settings.vaultName);
							return;
						}
						this.plugin.settings.vaultName = value;
						await this.plugin.saveSettings();
					}),
			);

		if (this.plugin.settings.resolvedVaultId) {
			new Setting(containerEl)
				.setName('目前已綁定的 vaultId')
				.setDesc(
					`${this.plugin.settings.resolvedVaultId}（對應名稱：${this.plugin.settings.resolvedVaultName ?? ''}）`,
				);
		}
	}
}
