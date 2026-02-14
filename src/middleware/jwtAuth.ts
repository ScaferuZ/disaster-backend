import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { JWT_AUTH_ENABLED, JWT_COOKIE_NAME, JWT_PUBLIC_PATHS, JWT_SECRET } from "../config";

const publicPaths = new Set(JWT_PUBLIC_PATHS);

function parseBearerToken(authHeader: string | undefined) {
	if (!authHeader) return null;
	const [scheme, token] = authHeader.split(" ");
	if (!scheme || !token) return null;
	if (scheme.toLowerCase() !== "bearer") return null;
	return token.trim();
}

export const apiJwtAuth: MiddlewareHandler = async (c, next) => {
	if (!JWT_AUTH_ENABLED || publicPaths.has(c.req.path)) {
		return next();
	}

	const authHeaderToken = parseBearerToken(c.req.header("authorization"));
	const cookieToken = getCookie(c, JWT_COOKIE_NAME);
	const queryToken = c.req.query("token");
	const token = authHeaderToken || cookieToken || queryToken;

	if (!token) {
		c.header("WWW-Authenticate", "Bearer");
		return c.json({ ok: false, error: "missing bearer token" }, 401);
	}

	try {
		const payload = await verify(token, JWT_SECRET, "HS256");
		c.set("jwtPayload", payload);
		return next();
	} catch {
		c.header("WWW-Authenticate", "Bearer error=\"invalid_token\"");
		return c.json({ ok: false, error: "invalid or expired token" }, 401);
	}
};
