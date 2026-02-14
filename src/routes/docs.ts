import { Hono } from "hono";
import {
	ACKS_STREAM,
	ALERTS_CHANNEL,
	ALERTS_STREAM,
	AUTH_USER_EMAIL_KEY_PREFIX,
	AUTH_USER_IDENTITY_KEY_PREFIX,
	AUTH_USER_KEY_PREFIX,
	JWT_PUBLIC_PATHS,
	PUSH_SUBSCRIPTIONS_HASH,
	REPORT_SYNC_STREAM,
} from "../config";

const route = new Hono();

const openApiDoc = {
	openapi: "3.0.3",
	info: {
		title: "Disaster Distribution Hub API",
		version: "1.0.0",
		description:
			"API for report ingestion, live delivery acknowledgements, SSE/WS/PUSH distribution support, and experiment metrics.",
	},
	servers: [{ url: "/" }],
	tags: [
		{ name: "Health", description: "Service health and runtime configuration" },
		{ name: "Report", description: "Report ingestion and ML-triggered alert generation" },
		{ name: "ACK", description: "Client delivery acknowledgement logging" },
		{ name: "SSE", description: "Server-Sent Events delivery channel" },
		{ name: "WebSocket", description: "WebSocket delivery channel" },
		{ name: "Push", description: "Web Push subscription and key management" },
		{ name: "Auth", description: "User registration and JWT authentication" },
		{ name: "Docs", description: "OpenAPI and Swagger documentation endpoints" },
	],
	paths: {
		"/api/health": {
			get: {
				summary: "Health check with runtime config",
				tags: ["Health"],
				responses: {
					"200": {
						description: "Service status and stream/channel metadata",
					},
				},
			},
		},
		"/api/report": {
			post: {
				summary: "Submit a disaster report for ML inference and distribution",
				tags: ["Report"],
				security: [{ bearerAuth: [] }],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/PredictionInput" },
						},
					},
				},
				responses: {
					"200": { description: "Report accepted and canonical alert generated" },
					"400": { description: "Invalid payload" },
					"502": { description: "ML service failure" },
				},
			},
		},
		"/api/ack": {
			post: {
				summary: "Send client receipt ACK for SSE/WS/PUSH delivery",
				tags: ["ACK"],
				security: [{ bearerAuth: [] }],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AckInput" },
						},
					},
				},
				responses: {
					"200": { description: "ACK logged" },
					"400": { description: "Invalid payload" },
				},
			},
		},
		"/api/sse": {
			get: {
				summary: "Server-Sent Events alert stream",
				tags: ["SSE"],
				security: [{ bearerAuth: [] }],
				description: "Streams `hello`, `ping`, and `alert` events as SSE.",
				responses: {
					"200": { description: "SSE stream opened" },
				},
			},
		},
		"/api/ws": {
			get: {
				summary: "WebSocket alert stream endpoint",
				tags: ["WebSocket"],
				security: [{ bearerAuth: [] }],
				description: "Upgrade request to WebSocket for realtime alert messages.",
				responses: {
					"101": { description: "Switching Protocols" },
				},
			},
		},
		"/api/push/vapid-public-key": {
			get: {
				summary: "Get VAPID public key for browser push subscription",
				tags: ["Push"],
				responses: {
					"200": { description: "VAPID public key" },
					"503": { description: "Push not configured" },
				},
			},
		},
		"/api/push/subscribe": {
			post: {
				summary: "Store browser push subscription",
				tags: ["Push"],
				security: [{ bearerAuth: [] }],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/PushSubscription" },
						},
					},
				},
				responses: {
					"200": { description: "Subscription saved" },
					"400": { description: "Invalid subscription payload" },
					"503": { description: "Push not configured" },
				},
			},
		},
		"/api/push/unsubscribe": {
			post: {
				summary: "Remove browser push subscription by endpoint",
				tags: ["Push"],
				security: [{ bearerAuth: [] }],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["endpoint"],
								properties: {
									endpoint: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"200": { description: "Subscription removed" },
					"400": { description: "Invalid payload" },
					"503": { description: "Push not configured" },
				},
			},
		},
		"/api/openapi.json": {
			get: {
				summary: "OpenAPI document for this service",
				tags: ["Docs"],
				responses: {
					"200": { description: "OpenAPI JSON document" },
				},
			},
		},
		"/api/docs": {
			get: {
				summary: "Swagger UI for the API",
				tags: ["Docs"],
				responses: {
					"200": { description: "Swagger UI HTML page" },
				},
			},
		},
		"/api/auth/register": {
			post: {
				summary: "Register a nelayan account",
				tags: ["Auth"],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/RegisterInput" },
						},
					},
				},
				responses: {
					"201": { description: "Account created" },
					"400": { description: "Invalid payload" },
					"409": { description: "Email or identity already registered" },
				},
			},
		},
		"/api/auth/login": {
			post: {
				summary: "Login and issue JWT",
				tags: ["Auth"],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/LoginInput" },
						},
					},
				},
				responses: {
					"200": { description: "JWT issued" },
					"400": { description: "Invalid payload" },
					"401": { description: "Invalid credentials" },
				},
			},
		},
		"/api/auth/logout": {
			post: {
				summary: "Clear auth cookie",
				tags: ["Auth"],
				security: [{ bearerAuth: [] }],
				responses: {
					"200": { description: "Logged out" },
				},
			},
		},
		"/api/auth/me": {
			get: {
				summary: "Get decoded JWT payload",
				tags: ["Auth"],
				security: [{ bearerAuth: [] }],
				responses: {
					"200": { description: "Authenticated payload" },
					"401": { description: "Missing/invalid token" },
				},
			},
		},
	},
	components: {
		securitySchemes: {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				bearerFormat: "JWT",
			},
		},
		schemas: {
			PredictionInput: {
				type: "object",
				required: [
					"lik_codes",
					"level_of_interaction_with_disaster",
					"age",
					"usage_duration",
					"min_frequency_of_usage",
					"fishing_experience",
				],
				properties: {
					lik_codes: { type: "array", items: { type: "string" } },
					level_of_interaction_with_disaster: { type: "number" },
					age: { type: "number" },
					usage_duration: { type: "number" },
					min_frequency_of_usage: { type: "number" },
					fishing_experience: { type: "number" },
					clientReportId: { type: "string", format: "uuid", nullable: true },
					createdAtClient: { type: "number", nullable: true },
				},
			},
			AckInput: {
				type: "object",
				required: ["alertId", "transport", "receivedAtClient", "serverTimestamp"],
				properties: {
					alertId: { type: "string" },
					transport: { type: "string", enum: ["SSE", "WS", "PUSH"] },
					receivedAtClient: { type: "number" },
					serverTimestamp: { type: "number" },
					ackStage: { type: "string", enum: ["DELIVERED", "OPENED"], nullable: true },
					clientId: { type: "string", nullable: true },
				},
			},
			PushSubscription: {
				type: "object",
				required: ["endpoint", "keys"],
				properties: {
					endpoint: { type: "string" },
					expirationTime: { type: "number", nullable: true },
					keys: {
						type: "object",
						required: ["p256dh", "auth"],
						properties: {
							p256dh: { type: "string" },
							auth: { type: "string" },
						},
					},
				},
			},
			RegisterInput: {
				type: "object",
				required: ["nama", "noIdentitasNelayan", "email", "password"],
				properties: {
					nama: { type: "string" },
					noIdentitasNelayan: { type: "string" },
					email: { type: "string", format: "email" },
					password: { type: "string", minLength: 8 },
				},
			},
			LoginInput: {
				type: "object",
				required: ["email", "password"],
				properties: {
					email: { type: "string", format: "email" },
					password: { type: "string" },
				},
			},
			PublicUser: {
				type: "object",
				properties: {
					userId: { type: "string" },
					nama: { type: "string" },
					noIdentitasNelayan: { type: "string" },
					email: { type: "string", format: "email" },
					createdAt: { type: "number" },
				},
			},
			StreamNames: {
				type: "object",
				properties: {
					alerts: { type: "string", example: ALERTS_STREAM },
					acks: { type: "string", example: ACKS_STREAM },
					reportSync: { type: "string", example: REPORT_SYNC_STREAM },
					pushSubscriptions: { type: "string", example: PUSH_SUBSCRIPTIONS_HASH },
					authUsers: { type: "string", example: AUTH_USER_KEY_PREFIX },
					authUserEmailIndex: { type: "string", example: AUTH_USER_EMAIL_KEY_PREFIX },
					authUserIdentityIndex: { type: "string", example: AUTH_USER_IDENTITY_KEY_PREFIX },
				},
			},
			HealthDeliveryFlags: {
				type: "object",
				properties: {
					sse: { type: "boolean" },
					ws: { type: "boolean" },
					push: { type: "boolean" },
				},
			},
			HealthPush: {
				type: "object",
				properties: {
					configured: { type: "boolean" },
					subscriptions: { type: "number" },
				},
			},
			HealthAuth: {
				type: "object",
				properties: {
					enabled: { type: "boolean" },
					publicPaths: {
						type: "array",
						items: { type: "string" },
						example: JWT_PUBLIC_PATHS,
					},
				},
			},
			HealthResponse: {
				type: "object",
				properties: {
					ok: { type: "boolean" },
					redis: { type: "string" },
					mlBaseUrl: { type: "string" },
					channel: { type: "string", example: ALERTS_CHANNEL },
					streams: { $ref: "#/components/schemas/StreamNames" },
					delivery: { $ref: "#/components/schemas/HealthDeliveryFlags" },
					auth: { $ref: "#/components/schemas/HealthAuth" },
					push: { $ref: "#/components/schemas/HealthPush" },
					ts: { type: "number" },
				},
			},
		},
	},
} as const;

route.get("/openapi.json", (c) => c.json(openApiDoc));

route.get("/docs", (c) => {
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Disaster Hub API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: "#swagger-ui",
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;

	return c.html(html);
});

export default route;
