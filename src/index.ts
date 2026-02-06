import { Hono } from "hono";
import { initRedis, sub } from "./lib/redis";
import { ALERTS_CHANNEL, PORT } from "./config";
import healthRoute from "./routes/health";
import sseRoute, { sseClients } from "./routes/sse";
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
});

app.route("/api", healthRoute);
app.route("/api", sseRoute);
app.route("/api", ackRoute);
app.route("/api", reportRoute);

export default {
	port: PORT,
	idleTimeout: 0,
	fetch: app.fetch,
};
