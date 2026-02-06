import { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";

export const sseClients = new Set<SSEStreamingApi>();

const route = new Hono();

route.get("/sse", (c) => {
	return streamSSE(c, async (stream) => {
		sseClients.add(stream);
		let active = true;
		stream.onAbort(() => {
			active = false;
			sseClients.delete(stream);
		});

		await stream.writeSSE({
			event: "hello",
			data: JSON.stringify({ connectedAt: Date.now() }),
		});

		while (active) {
			await stream.sleep(10000);
			try {
				await stream.writeSSE({ event: "ping", data: String(Date.now()) });
			} catch {
				active = false;
				sseClients.delete(stream);
			}
		}
	});
});

export default route;
