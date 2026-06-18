import {
	WA_SEND_STREAM,
	WAHA_API_KEY,
	WAHA_API_URL,
	WAHA_BROADCAST_GROUPS,
	WAHA_SESSION,
} from "../config";
import { redis } from "./redis";

type StreamFields = Record<string, string>;

type RedisLike = {
	xAdd: (stream: string, id: string, fields: StreamFields) => Promise<unknown>;
};

type SendWAAlertDeps = {
	redis?: RedisLike;
	fetchFn?: typeof fetch;
};

// WAHA /sendText returns one of: { id }, { id: { id | _serialized } }, { _data: { id... } }
function extractMessageId(body: unknown): string | null {
	if (!body || typeof body !== "object") return null;
	const obj = body as Record<string, unknown>;

	const id = obj.id;
	if (typeof id === "string") return id;
	if (id && typeof id === "object") {
		const nested = (id as Record<string, unknown>).id;
		if (typeof nested === "string") return nested;
		const serialized = (id as Record<string, unknown>)._serialized;
		if (typeof serialized === "string") return serialized;
	}

	const data = obj._data;
	if (data && typeof data === "object") {
		const dataId = (data as Record<string, unknown>).id;
		if (typeof dataId === "string") return dataId;
		if (dataId && typeof dataId === "object") {
			const nested = (dataId as Record<string, unknown>).id;
			if (typeof nested === "string") return nested;
			const serialized = (dataId as Record<string, unknown>)._serialized;
			if (typeof serialized === "string") return serialized;
		}
	}

	return null;
}

// Not-configured -> early return writes NO stream entry. Stream logging is best-effort.
export async function sendWAAlert(
	text: string,
	experimentId?: string | null,
	deps: SendWAAlertDeps = {},
): Promise<void> {
	if (!WAHA_API_KEY || !WAHA_API_URL) {
		console.warn("[waha] WAHA not configured, skipping WA broadcast");
		return;
	}

	const redisClient = deps.redis ?? redis;
	const fetchFn = deps.fetchFn ?? globalThis.fetch;

	async function logSend(fields: {
		chatId: string;
		status: "SENT" | "FAILED";
		httpStatus: number | null;
		messageId: string | null;
		error: string | null;
	}) {
		try {
			await redisClient.xAdd(WA_SEND_STREAM, "*", {
				timestamp: String(Date.now()),
				chatId: fields.chatId,
				status: fields.status,
				httpStatus: fields.httpStatus === null ? "" : String(fields.httpStatus),
				messageId: fields.messageId ?? "",
				experimentId: experimentId ?? "",
				error: fields.error ?? "",
			});
		} catch (logErr) {
			console.error(`[waha] failed to log ${WA_SEND_STREAM} for ${fields.chatId}:`, logErr);
		}
	}

	for (const chatId of WAHA_BROADCAST_GROUPS) {
		try {
			const res = await fetchFn(`${WAHA_API_URL}/sendText`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Api-Key": WAHA_API_KEY,
				},
				body: JSON.stringify({
					session: WAHA_SESSION,
					chatId,
					text,
				}),
			});

			if (!res.ok) {
				const detail = await res.text().catch(() => "");
				console.error(`[waha] sendText failed for ${chatId}: ${res.status} ${detail}`);
				await logSend({
					chatId,
					status: "FAILED",
					httpStatus: res.status,
					messageId: null,
					error: detail || `HTTP ${res.status}`,
				});
				continue;
			}

			let messageId: string | null = null;
			try {
				const body = await res.json();
				messageId = extractMessageId(body);
			} catch {
				messageId = null;
			}

			await logSend({
				chatId,
				status: "SENT",
				httpStatus: res.status,
				messageId,
				error: null,
			});
		} catch (err) {
			console.error(`[waha] sendText error for ${chatId}:`, err);
			await logSend({
				chatId,
				status: "FAILED",
				httpStatus: null,
				messageId: null,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}
