const port = Number(process.env.PORT ?? 8080);
const token = process.env.MOCK_PUSH_SINK_TOKEN?.trim() ?? "";

if (!token) {
	throw new Error("MOCK_PUSH_SINK_TOKEN is required");
}

let received = 0;
let lastReceivedAt: number | null = null;

Bun.serve({
	port,
	async fetch(request) {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/health") {
			return Response.json({ ok: true, received, lastReceivedAt });
		}

		if (request.headers.get("authorization") !== `Bearer ${token}`) {
			return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
		}

		if (request.method === "GET" && url.pathname === "/stats") {
			return Response.json({ ok: true, received, lastReceivedAt });
		}

		if (request.method !== "POST" || url.pathname !== "/push") {
			return Response.json({ ok: false, error: "Not found" }, { status: 404 });
		}

		const body = await request.json().catch(() => null);
		if (!body || typeof body !== "object") {
			return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
		}

		received += 1;
		lastReceivedAt = Date.now();
		return Response.json({ ok: true, receivedAt: lastReceivedAt }, { status: 201 });
	},
});

console.log(`[mock-push-sink] listening on :${port}`);
