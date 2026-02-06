import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";

export const wsClients = new Set<WSContext>();

const route = new Hono();

route.get(
	"/ws",
	upgradeWebSocket(() => ({
		onOpen(_event, ws) {
			wsClients.add(ws);
			ws.send(JSON.stringify({ event: "hello", connectedAt: Date.now() }));
		},
		onClose(_event, ws) {
			wsClients.delete(ws);
		},
		onError(_event, ws) {
			wsClients.delete(ws);
		},
	})),
);

export default route;
