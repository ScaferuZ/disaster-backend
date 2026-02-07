import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const route = new Hono();

route.get("/", serveStatic({ path: "./public/index.html" }));
route.get("/app.js", serveStatic({ path: "./public/app.js" }));
route.get("/sw.js", serveStatic({ path: "./public/sw.js" }));

export default route;
