import type { PluginData } from '../types';

/** 同一個 path 在這段時間內沒有再變動才進入合併，避免頻繁編輯時每次都觸發合併。 */
export const DEBOUNCE_MS = 1500;

export type RawEventKind = 'create' | 'modify' | 'delete';

/**
 * 把一個新事件合併進 settings.syncQueue。
 *
 * baseVersion 只在第一次進佇列時決定，之後不再重新計算——佇列項目還沒送
 * 出去之前，fileVersions 不會變動。
 *
 * 還沒送出去的檔案被刪除時不會整列移除，而是照常標成 isDeleted 送出去；
 * 換來合併邏輯簡單，代價是這類檔案會多打一次 API、留一筆可接受的刪除記錄。
 */
export function mergeQueueItem(
	settings: PluginData,
	vaultId: string,
	path: string,
	kind: RawEventKind,
): void {
	const queue = settings.syncQueue;
	// 一併比對 entityType='FILE'：VAULT command 的 entityId 是 vault 名稱，
	// 萬一剛好跟某個檔案路徑撞字面值，不比對 entityType 會誤把 VAULT 那筆
	// 佇列項目當成同一個檔案來合併、覆寫掉它的 payload。
	const idx = queue.findIndex((item) => item.entityType === 'FILE' && item.entityId === path);
	const isDeleted = kind === 'delete';

	if (idx === -1) {
		const knownVersion = settings.fileVersions[path] ?? 0;
		queue.push({
			entityType: 'FILE',
			vaultId,
			entityId: path,
			mutationId: crypto.randomUUID(),
			baseVersion: kind === 'create' ? 0 : knownVersion,
			payload: { isDeleted },
		});
		return;
	}

	const existing = queue[idx]!;
	if (existing.entityType !== 'FILE') return; // 上面 findIndex 已保證不會發生，純粹讓 TS 窄化型別
	existing.payload.isDeleted = isDeleted;
	existing.mutationId = crypto.randomUUID();
}

/**
 * 排入這個 vault 的建立指令，只會發生一次：若佇列裡已經有一筆待送出的
 * VAULT command 就略過，避免同一個候選 vaultId 被重複排隊。
 *
 * 用 unshift 而非 push：確保它一定排在佇列裡任何引用同一個 vaultId 的
 * FILE command 之前——後端依陣列順序處理，VAULT 沒排最前面的話，FILE
 * command 會因為 vaultId 還沒建立而被判 ERROR。
 */
export function enqueueVaultCreate(settings: PluginData, vaultId: string, name: string): void {
	const alreadyQueued = settings.syncQueue.some((item) => item.entityType === 'VAULT');
	if (alreadyQueued) return;

	settings.syncQueue.unshift({
		entityType: 'VAULT',
		vaultId,
		entityId: name,
		mutationId: crypto.randomUUID(),
		baseVersion: 0,
		payload: {},
	});
}

interface QueueTarget {
	/** 事件發生當下應該寫入哪個 vault 的佇列；尚未解析過 vaultId 時回傳 null。 */
	getVaultState(): { vaultId: string; settings: PluginData } | null;
	onQueueChanged(): void;
}

/**
 * 監聽 vault 事件、debounce、合併進佇列。第一次成功解析出 vaultId 之前的事件
 * 不會被追蹤——這是刻意接受的已知限制，不是遺漏。
 */
export class SyncQueueManager {
	private target: QueueTarget;
	private timers = new Map<string, number>();
	private pendingKinds = new Map<string, RawEventKind>();

	constructor(target: QueueTarget) {
		this.target = target;
	}

	onVaultEvent(path: string, kind: RawEventKind): void {
		this.pendingKinds.set(path, kind);
		const existingTimer = this.timers.get(path);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}
		const handle = window.setTimeout(() => {
			this.timers.delete(path);
			const finalKind = this.pendingKinds.get(path);
			this.pendingKinds.delete(path);
			if (finalKind) this.commit(path, finalKind);
		}, DEBOUNCE_MS);
		this.timers.set(path, handle);
	}

	/** rename 拆成對舊路徑 DELETE、對新路徑 CREATE，各自獨立走合併規則。 */
	onRenameEvent(oldPath: string, newPath: string): void {
		this.onVaultEvent(oldPath, 'delete');
		this.onVaultEvent(newPath, 'create');
	}

	/** 觸發同步前呼叫，強制結束所有還在計時中的 debounce，確保佇列反映最新變動。 */
	flushAll(): void {
		const pending = new Map(this.pendingKinds);
		for (const handle of this.timers.values()) {
			window.clearTimeout(handle);
		}
		this.timers.clear();
		this.pendingKinds.clear();
		for (const [path, kind] of pending) {
			this.commit(path, kind);
		}
	}

	/** plugin onunload 時呼叫，只清計時器，不強制合併（避免在卸載當下寫入狀態）。 */
	dispose(): void {
		for (const handle of this.timers.values()) {
			window.clearTimeout(handle);
		}
		this.timers.clear();
		this.pendingKinds.clear();
	}

	private commit(path: string, kind: RawEventKind): void {
		const target = this.target.getVaultState();
		if (!target) return;
		mergeQueueItem(target.settings, target.vaultId, path, kind);
		this.target.onQueueChanged();
	}
}
