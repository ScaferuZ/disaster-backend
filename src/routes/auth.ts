import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { JWT_COOKIE_NAME, JWT_EXPIRES_SECONDS } from "../config";
import { authenticateUser, issueJwt, registerUser, validateRegisterInput } from "../lib/auth";

const route = new Hono();

route.post("/auth/register", async (c) => {
	const input = await c.req
		.json<{ nama?: string; noIdentitasNelayan?: string; email?: string; password?: string }>()
		.catch(() => null);
	if (!input) return c.json({ ok: false, error: "Invalid JSON" }, 400);

	const validated = validateRegisterInput({
		nama: input.nama ?? "",
		noIdentitasNelayan: input.noIdentitasNelayan ?? "",
		email: input.email ?? "",
		password: input.password ?? "",
	});
	if (!validated.ok) {
		return c.json({ ok: false, error: validated.error }, 400);
	}

	const created = await registerUser(validated.value);
	if (!created.ok) {
		return c.json({ ok: false, error: created.error }, created.status);
	}

	return c.json({ ok: true, user: created.user }, 201);
});

route.post("/auth/login", async (c) => {
	const input = await c.req.json<{ email?: string; password?: string }>().catch(() => null);
	if (!input) return c.json({ ok: false, error: "Invalid JSON" }, 400);
	if (!input.email || !input.password) {
		return c.json({ ok: false, error: "email and password required" }, 400);
	}

	const user = await authenticateUser(input.email, input.password);
	if (!user) {
		return c.json({ ok: false, error: "invalid credentials" }, 401);
	}

	const token = await issueJwt(user);
	setCookie(c, JWT_COOKIE_NAME, token, {
		httpOnly: true,
		sameSite: "Lax",
		path: "/",
		maxAge: JWT_EXPIRES_SECONDS,
	});

	return c.json({
		ok: true,
		token,
		expiresIn: JWT_EXPIRES_SECONDS,
		user,
	});
});

route.post("/auth/logout", (c) => {
	deleteCookie(c, JWT_COOKIE_NAME, { path: "/" });
	return c.json({ ok: true });
});

route.get("/auth/me", (c) => {
	const payload = c.get("jwtPayload");
	return c.json({ ok: true, user: payload });
});

export default route;
