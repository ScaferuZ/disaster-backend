import { WAHA_API_KEY, WAHA_API_URL, WAHA_BROADCAST_GROUPS, WAHA_SESSION } from "../config";

export async function sendWAAlert(text: string): Promise<void> {
	if (!WAHA_API_KEY || !WAHA_API_URL) {
		console.warn("[waha] WAHA not configured, skipping WA broadcast");
		return;
	}

	for (const chatId of WAHA_BROADCAST_GROUPS) {
		try {
			const res = await fetch(`${WAHA_API_URL}/sendText`, {
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
			}
		} catch (err) {
			console.error(`[waha] sendText error for ${chatId}:`, err);
		}
	}
}
