export type StreamRowInput =
	| { id: string; fields: Record<string, string> }
	| readonly [string, readonly unknown[]];

export type ParsedStreamEntry = {
	id: string;
	fields: Record<string, string>;
	parsedJson: unknown | null;
};

export type MockRedis = ReturnType<typeof createMockRedis>;

type RedisSetOptions = {
	NX?: boolean;
	EX?: number;
};

type StreamFields = Record<string, string>;

type StoredValue = {
	value: string;
	expiresAt: number | null;
};

type ZSetEntry = {
	score: number;
	value: string;
};

type HashStore = Map<string, Map<string, string>>;

type Calls = {
	xAdd: Array<{ stream: string; id: string; fields: StreamFields }>;
	get: Array<{ key: string }>;
	set: Array<{ key: string; value: string; options?: RedisSetOptions }>;
	del: Array<{ key: string }>;
	hSet: Array<{ key: string; field: string; value: string }>;
	hDel: Array<{ key: string; field: string }>;
	hVals: Array<{ key: string }>;
	zAdd: Array<{ key: string; score: number; value: string }>;
	zRemRangeByScore: Array<{ key: string; min: number; max: number }>;
	zCard: Array<{ key: string }>;
	publish: Array<{ channel: string; message: string }>;
};

function normalizeFields(fields: readonly unknown[]): StreamFields {
	const normalized: StreamFields = {};
	for (let idx = 0; idx < fields.length; idx += 2) {
		const field = fields[idx];
		const value = fields[idx + 1];
		if (field === undefined || value === undefined) continue;
		normalized[String(field)] = String(value);
	}
	return normalized;
}

export function parseStreamJson(entries: readonly StreamRowInput[]): ParsedStreamEntry[] {
	const parsed: ParsedStreamEntry[] = [];

	for (const entry of entries) {
		let id: string;
		let fields: Record<string, string>;

		if (Array.isArray(entry)) {
			id = String(entry[0]);
			fields = normalizeFields(entry[1]);
		} else if ("id" in entry && "fields" in entry) {
			id = entry.id;
			fields = { ...entry.fields };
		} else {
			continue;
		}

		let parsedJson: unknown | null = null;
		if (typeof fields.json === "string") {
			try {
				parsedJson = JSON.parse(fields.json);
			} catch {
				parsedJson = null;
			}
		}

		parsed.push({ id, fields, parsedJson });
	}

	return parsed;
}

export function createMockRedis() {
	const kv = new Map<string, StoredValue>();
	const hashes: HashStore = new Map();
	const zsets = new Map<string, Map<string, ZSetEntry>>();
	const streams = new Map<string, Array<{ id: string; fields: StreamFields }>>();
	const calls: Calls = {
		xAdd: [],
		get: [],
		set: [],
		del: [],
		hSet: [],
		hDel: [],
		hVals: [],
		zAdd: [],
		zRemRangeByScore: [],
		zCard: [],
		publish: [],
	};
	let streamCounter = 0;

	function isExpired(entry: StoredValue | undefined) {
		return entry !== undefined && entry.expiresAt !== null && entry.expiresAt <= Date.now();
	}

	function readValue(key: string) {
		const entry = kv.get(key);
		if (isExpired(entry)) {
			kv.delete(key);
			return null;
		}
		return entry?.value ?? null;
	}

	function ensureHash(key: string) {
		let hash = hashes.get(key);
		if (!hash) {
			hash = new Map();
			hashes.set(key, hash);
		}
		return hash;
	}

	function ensureZSet(key: string) {
		let zset = zsets.get(key);
		if (!zset) {
			zset = new Map();
			zsets.set(key, zset);
		}
		return zset;
	}

	function ensureStream(key: string) {
		let stream = streams.get(key);
		if (!stream) {
			stream = [];
			streams.set(key, stream);
		}
		return stream;
	}

	return {
		calls,
		state: { kv, hashes, zsets, streams },
		async xAdd(stream: string, id: string, fields: StreamFields) {
			const storedId = id === "*" ? `${Date.now()}-${++streamCounter}` : id;
			const normalizedFields = { ...fields };
			ensureStream(stream).push({ id: storedId, fields: normalizedFields });
			calls.xAdd.push({ stream, id: storedId, fields: normalizedFields });
			return storedId;
		},
		async get(key: string) {
			calls.get.push({ key });
			return readValue(key);
		},
		async set(key: string, value: string, options?: RedisSetOptions) {
			calls.set.push({ key, value, options });
			if (options?.NX && readValue(key) !== null) return null;
			const expiresAt = typeof options?.EX === "number" ? Date.now() + options.EX * 1000 : null;
			kv.set(key, { value, expiresAt });
			return "OK";
		},
		async del(key: string) {
			calls.del.push({ key });
			const existed = kv.delete(key) ? 1 : 0;
			return existed;
		},
		async hSet(key: string, field: string, value: string) {
			calls.hSet.push({ key, field, value });
			const hash = ensureHash(key);
			const isNew = hash.has(field) ? 0 : 1;
			hash.set(field, value);
			return isNew;
		},
		async hDel(key: string, field: string) {
			calls.hDel.push({ key, field });
			const hash = hashes.get(key);
			if (!hash) return 0;
			const removed = hash.delete(field) ? 1 : 0;
			if (hash.size === 0) hashes.delete(key);
			return removed;
		},
		async hVals(key: string) {
			calls.hVals.push({ key });
			return Array.from(hashes.get(key)?.values() ?? []);
		},
		async zAdd(key: string, entry: { score: number; value: string }) {
			calls.zAdd.push({ key, score: entry.score, value: entry.value });
			const zset = ensureZSet(key);
			const isNew = zset.has(entry.value) ? 0 : 1;
			zset.set(entry.value, { score: entry.score, value: entry.value });
			return isNew;
		},
		async zRemRangeByScore(key: string, min: number, max: number) {
			calls.zRemRangeByScore.push({ key, min, max });
			const zset = zsets.get(key);
			if (!zset) return 0;
			let removed = 0;
			for (const [member, entry] of zset.entries()) {
				if (entry.score >= min && entry.score <= max) {
					zset.delete(member);
					removed += 1;
				}
			}
			if (zset.size === 0) zsets.delete(key);
			return removed;
		},
		async zCard(key: string) {
			calls.zCard.push({ key });
			return zsets.get(key)?.size ?? 0;
		},
		async publish(channel: string, message: string) {
			calls.publish.push({ channel, message });
			return 0;
		},
		async connect() {},
		async close() {},
		duplicate() {
			return this;
		},
	};
}
