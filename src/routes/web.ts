import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const route = new Hono();
const noStore = {
	onFound: (_path: string, c: { header: (name: string, value: string) => void }) => {
		c.header("cache-control", "no-store");
	},
};

route.get("/", serveStatic({ path: "./public/index.html", ...noStore }));
route.get("/app.js", serveStatic({ path: "./public/app.js", ...noStore }));
route.get("/sw.js", serveStatic({ path: "./public/sw.js", ...noStore }));
route.get("/receiver", serveStatic({ path: "./public/receiver.html", ...noStore }));
route.get("/receiver.js", serveStatic({ path: "./public/receiver.js", ...noStore }));

export default route;
