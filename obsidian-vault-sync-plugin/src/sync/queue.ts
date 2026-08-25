import type { VaultLocalState } from '../types';

/** 同一個 path 在這段時間內沒有再變動才進入合併，避免頻繁編輯時每次都觸發合併。 */
export const DEBOUNCE_MS = 1500;

export type RawEventKind = 'create' | 'modify' | 'delete';

/**
 * 把一個新事件合併進 state.syncQueue。
 *
 * baseVersion 只在第一次進佇列時決定，之後不再重新計算——佇列項目還沒送
 * 出去之前，fileVersions 不會變動。
 *
 * 還沒送出去的檔案被刪除時不會整列移除，而是照常標成 isDeleted 送出去；
 * 換來合併邏輯簡單，代價是這類檔案會多打一次 API、留一筆可接受的刪除記錄。
 */
export function mergeQueueItem(state: VaultLocalState, path: string, kind: RawEventKind): void {
	const queue = state.syncQueue;
	const idx = queue.findIndex((item) => item.entityId === path);
	const isDeleted = kind === 'delete';

	if (idx === -1) {
		const knownVersion = state.fileVersions[path] ?? 0;
		queue.push({
			entityType: 'FILE',
			entityId: path,
			mutationId: crypto.randomUUID(),
			baseVersion: kind === 'create' ? 0 : knownVersion,
			payload: { isDeleted },
		});
		return;
	}

	const existing = queue[idx]!;
	existing.payload.isDeleted = isDeleted;
	existing.mutationId = crypto.randomUUID();
}

interface QueueTarget {
	/** 事件發生當下應該寫入哪個 vaultId 的佇列；尚未解析過 vaultId 時回傳 null。 */
	getVaultState(): VaultLocalState | null;
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
		const state = this.target.getVaultState();
		if (!state) return;
		mergeQueueItem(state, path, kind);
		this.target.onQueueChanged();
	}
}
