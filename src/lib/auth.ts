import { sign } from "hono/jwt";
import {
	AUTH_USER_EMAIL_KEY_PREFIX,
	AUTH_USER_IDENTITY_KEY_PREFIX,
	AUTH_USER_KEY_PREFIX,
	JWT_EXPIRES_SECONDS,
	JWT_SECRET,
} from "../config";
import { redis } from "./redis";

type RegisterInput = {
	nama: string;
	noIdentitasNelayan: string;
	email: string;
	password: string;
};

type StoredUser = {
	userId: string;
	nama: string;
	noIdentitasNelayan: string;
	email: string;
	passwordHash: string;
	createdAt: number;
};

type PublicUser = Omit<StoredUser, "passwordHash">;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailKey(email: string) {
	return `${AUTH_USER_EMAIL_KEY_PREFIX}:${email}`;
}

function identityKey(noIdentitasNelayan: string) {
	return `${AUTH_USER_IDENTITY_KEY_PREFIX}:${noIdentitasNelayan}`;
}

function userKey(userId: string) {
	return `${AUTH_USER_KEY_PREFIX}:${userId}`;
}

function toPublicUser(user: StoredUser): PublicUser {
	return {
		userId: user.userId,
		nama: user.nama,
		noIdentitasNelayan: user.noIdentitasNelayan,
		email: user.email,
		createdAt: user.createdAt,
	};
}

export function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

export function validateRegisterInput(input: RegisterInput) {
	const nama = input.nama?.trim();
	const noIdentitasNelayan = input.noIdentitasNelayan?.trim();
	const email = normalizeEmail(input.email ?? "");
	const password = input.password ?? "";

	if (!nama) return { ok: false as const, error: "nama required" };
	if (nama.length > 120) return { ok: false as const, error: "nama max length is 120" };
	if (!noIdentitasNelayan) return { ok: false as const, error: "noIdentitasNelayan required" };
	if (noIdentitasNelayan.length > 64) {
		return { ok: false as const, error: "noIdentitasNelayan max length is 64" };
	}
	if (!EMAIL_REGEX.test(email)) return { ok: false as const, error: "email invalid" };
	if (password.length < 8) return { ok: false as const, error: "password min length is 8" };

	return {
		ok: true as const,
		value: {
			nama,
			noIdentitasNelayan,
			email,
			password,
		},
	};
}

export async function registerUser(input: RegisterInput) {
	const now = Date.now();
	const userId = crypto.randomUUID();
	const normalizedEmail = normalizeEmail(input.email);
	const cleanedIdentity = input.noIdentitasNelayan.trim();

	const reservedEmail = await redis.set(emailKey(normalizedEmail), userId, { NX: true });
	if (reservedEmail !== "OK") {
		return { ok: false as const, error: "email already registered", status: 409 as const };
	}

	const reservedIdentity = await redis.set(identityKey(cleanedIdentity), userId, { NX: true });
	if (reservedIdentity !== "OK") {
		await redis.del(emailKey(normalizedEmail));
		return {
			ok: false as const,
			error: "noIdentitasNelayan already registered",
			status: 409 as const,
		};
	}

	try {
		const passwordHash = await Bun.password.hash(input.password);
		const stored: StoredUser = {
			userId,
			nama: input.nama.trim(),
			noIdentitasNelayan: cleanedIdentity,
			email: normalizedEmail,
			passwordHash,
			createdAt: now,
		};
		await redis.set(userKey(userId), JSON.stringify(stored));
		return { ok: true as const, user: toPublicUser(stored) };
	} catch (error) {
		await redis.del(emailKey(normalizedEmail));
		await redis.del(identityKey(cleanedIdentity));
		throw error;
	}
}

async function getUserByEmail(email: string) {
	const normalized = normalizeEmail(email);
	const userId = await redis.get(emailKey(normalized));
	if (!userId) return null;
	const encoded = await redis.get(userKey(userId));
	if (!encoded) return null;
	return JSON.parse(encoded) as StoredUser;
}

export async function authenticateUser(email: string, password: string) {
	const user = await getUserByEmail(email);
	if (!user) return null;
	const valid = await Bun.password.verify(password, user.passwordHash);
	if (!valid) return null;
	return toPublicUser(user);
}

export async function issueJwt(user: PublicUser) {
	const nowSec = Math.floor(Date.now() / 1000);
	const payload = {
		sub: user.userId,
		email: user.email,
		nama: user.nama,
		noIdentitasNelayan: user.noIdentitasNelayan,
		iat: nowSec,
		exp: nowSec + JWT_EXPIRES_SECONDS,
	};
	return sign(payload, JWT_SECRET, "HS256");
}
