import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, VaultSyncSettingTab } from './settings';
import { runPull, runPush } from './sync/syncRunner';
import type { PluginData } from './types';

export default class VaultSyncPlugin extends Plugin {
	settings!: PluginData;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('upload', 'Vault Sync：Push', () => {
			void runPush(this);
		});
		this.addRibbonIcon('download', 'Vault Sync：Pull', () => {
			void runPull(this);
		});

		this.addCommand({
			id: 'vault-sync-push',
			name: 'Push（本地 → 遠端）',
			callback: () => {
				void runPush(this);
			},
		});
		this.addCommand({
			id: 'vault-sync-pull',
			name: 'Pull（遠端 → 本地）',
			callback: () => {
				void runPull(this);
			},
		});

		this.addSettingTab(new VaultSyncSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
