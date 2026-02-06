import { Hono } from "hono";
import { websocket } from "hono/bun";
import { initRedis, sub } from "./lib/redis";
import { ALERTS_CHANNEL, PORT } from "./config";
import healthRoute from "./routes/health";
import sseRoute, { sseClients } from "./routes/sse";
import wsRoute, { wsClients } from "./routes/ws";
import ackRoute from "./routes/ack";
import reportRoute from "./routes/report";

const app = new Hono();

await initRedis();

await sub.subscribe(ALERTS_CHANNEL, async (message) => {
	for (const client of sseClients) {
		try {
			await client.writeSSE({ event: "alert", data: message });
		} catch {
			sseClients.delete(client);
		}
	}

	for (const client of wsClients) {
		if (client.readyState !== 1) {
			wsClients.delete(client);
			continue;
		}
		try {
			client.send(message);
		} catch {
			wsClients.delete(client);
		}
	}
});

app.route("/api", healthRoute);
app.route("/api", sseRoute);
app.route("/api", wsRoute);
app.route("/api", ackRoute);
app.route("/api", reportRoute);

export default {
	port: PORT,
	idleTimeout: 0,
	fetch: app.fetch,
	websocket,
};
