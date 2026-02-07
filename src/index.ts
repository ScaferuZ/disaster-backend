import { Hono } from "hono";
import { websocket } from "hono/bun";
import { initRedis, sub } from "./lib/redis";
import { initWebPush, sendPushAlertToAll } from "./lib/push";
import { ALERTS_CHANNEL, PORT } from "./config";
import healthRoute from "./routes/health";
import sseRoute, { sseClients } from "./routes/sse";
import wsRoute, { wsClients } from "./routes/ws";
import pushRoute from "./routes/push";
import swRoute from "./routes/sw";
import ackRoute from "./routes/ack";
import reportRoute from "./routes/report";

const app = new Hono();

await initRedis();
initWebPush();

await sub.subscribe(ALERTS_CHANNEL, async (message) => {
	for (const client of sseClients) {
		try {
			await client.writeSSE({ event: "alert", data: message });
		} catch {
			sseClients.delete(client);
		}
	}

	for (const client of wsClients) {
		if (client.readyState !== WebSocket.OPEN) {
			wsClients.delete(client);
			continue;
		}
		try {
			client.send(message);
		} catch {
			wsClients.delete(client);
		}
	}

	const pushResult = await sendPushAlertToAll(message);
	if (pushResult.failed > 0 || pushResult.removed > 0) {
		console.info("[push]", pushResult);
	}
});

app.route("/api", healthRoute);
app.route("/api", sseRoute);
app.route("/api", wsRoute);
app.route("/api", pushRoute);
app.route("/api", ackRoute);
app.route("/api", reportRoute);
app.route("/", swRoute);

export default {
	port: PORT,
	idleTimeout: 0,
	fetch: app.fetch,
	websocket,
};
