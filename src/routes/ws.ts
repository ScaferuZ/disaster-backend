import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";

export const wsClients = new Set<WebSocket>();

const route = new Hono();

route.get(
	"/ws",
	upgradeWebSocket(() => ({
		onOpen(_event, ws) {
			if (!ws.raw) return;
			wsClients.add(ws.raw);
			ws.raw.send(JSON.stringify({ event: "hello", connectedAt: Date.now() }));
		},
		onClose(_event, ws) {
			if (!ws.raw) return;
			wsClients.delete(ws.raw);
		},
		onError(_event, ws) {
			if (!ws.raw) return;
			wsClients.delete(ws.raw);
		},
	})),
);

export default route;
