#!/usr/bin/env bun

type WorkflowExport = {
	id?: string;
	name?: string;
	nodes?: unknown[];
	connections?: Record<string, unknown>;
	settings?: Record<string, unknown>;
	staticData?: unknown;
	tags?: unknown[];
	active?: boolean;
	[key: string]: unknown;
};

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueAfter = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

const positional = args.filter((arg, index) => {
	if (arg.startsWith("--")) return false;
	const prev = args[index - 1];
	return !(prev === "--workflow-id" || prev === "--url");
});

const workflowPath = positional[0] ?? "WAHA - Chatting Template.json";
const shouldPush = has("--push");
const shouldActivate = has("--activate");
const checkRemote = has("--check-remote") || shouldPush || shouldActivate;
const workflowId = valueAfter("--workflow-id") ?? Bun.env.N8N_WORKFLOW_ID;
const n8nUrl = (valueAfter("--url") ?? Bun.env.N8N_URL ?? "").replace(/\/$/, "");
const apiKey = Bun.env.N8N_API_KEY;

function usage(): never {
	console.error(`Usage:
  bun run scripts/deploy-n8n-workflow.ts [workflow.json]
  bun run scripts/deploy-n8n-workflow.ts --check-remote [workflow.json]
  bun run scripts/deploy-n8n-workflow.ts --push [workflow.json]
  bun run scripts/deploy-n8n-workflow.ts --push --activate [workflow.json]

Env required for remote actions:
  N8N_URL
  N8N_API_KEY
  N8N_WORKFLOW_ID

Options:
  --push              Update the existing n8n workflow via API. Without this, dry-run only.
  --activate          Activate/publish after updating. Implies remote access.
  --check-remote      Fetch remote workflow metadata without pushing.
  --workflow-id <id>  Override N8N_WORKFLOW_ID.
  --url <url>         Override N8N_URL.
`);
	process.exit(1);
}

if (has("--help") || has("-h")) usage();

const workflowFile = Bun.file(workflowPath);
if (!(await workflowFile.exists())) {
	console.error(`[n8n-deploy] Workflow file not found: ${workflowPath}`);
	process.exit(1);
}

let workflow: WorkflowExport;
try {
	workflow = await workflowFile.json();
} catch (error) {
	console.error(`[n8n-deploy] Invalid JSON in ${workflowPath}`);
	console.error(error);
	process.exit(1);
}

if (!Array.isArray(workflow.nodes)) {
	console.error("[n8n-deploy] Workflow JSON is missing nodes[].");
	process.exit(1);
}
if (!workflow.connections || typeof workflow.connections !== "object") {
	console.error("[n8n-deploy] Workflow JSON is missing connections{}.");
	process.exit(1);
}

const triggerNodes = workflow.nodes.filter((node: any) => String(node?.type ?? "").includes("wahaTrigger"));
const assistantNodes = workflow.nodes.filter((node: any) => String(node?.name ?? "").startsWith("Assistant -"));
const waitNodes = workflow.nodes.filter((node: any) => node?.type === "n8n-nodes-base.wait");

console.log(`[n8n-deploy] File: ${workflowPath}`);
console.log(`[n8n-deploy] Workflow name: ${workflow.name ?? "(unnamed)"}`);
console.log(`[n8n-deploy] Local workflow id: ${workflow.id ?? "(none in file)"}`);
console.log(`[n8n-deploy] Nodes: ${workflow.nodes.length}`);
console.log(`[n8n-deploy] WAHA triggers: ${triggerNodes.length}`);
console.log(`[n8n-deploy] Assistant nodes: ${assistantNodes.length}`);
console.log(`[n8n-deploy] Wait nodes: ${waitNodes.map((node: any) => `${node.name}:${node.parameters?.amount}`).join(", ")}`);

if (triggerNodes.length !== 1) {
	console.error("[n8n-deploy] Refusing to continue: expected exactly one WAHA Trigger node.");
	process.exit(1);
}

if (!workflowId) {
	console.log("[n8n-deploy] N8N_WORKFLOW_ID is not set. Dry-run validation only.");
} else {
	console.log(`[n8n-deploy] Target workflow id: ${workflowId}`);
}

if (!checkRemote && !shouldPush && !shouldActivate) {
	console.log("[n8n-deploy] Dry-run complete. Pass --push to update n8n.");
	process.exit(0);
}

if (!n8nUrl || !apiKey || !workflowId) {
	console.error("[n8n-deploy] Remote action requires N8N_URL, N8N_API_KEY, and N8N_WORKFLOW_ID.");
	process.exit(1);
}

async function api(path: string, init: RequestInit = {}) {
	const response = await fetch(`${n8nUrl}${path}`, {
		...init,
		headers: {
			accept: "application/json",
			"content-type": "application/json",
			"X-N8N-API-KEY": apiKey,
			...(init.headers ?? {}),
		},
	});
	const text = await response.text();
	let body: unknown = text;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		// keep text body
	}
	if (!response.ok) {
		console.error(`[n8n-deploy] ${init.method ?? "GET"} ${path} failed: ${response.status}`);
		console.error(typeof body === "string" ? body : JSON.stringify(body, null, 2));
		process.exit(1);
	}
	return body as any;
}

const remote = await api(`/api/v1/workflows/${workflowId}`);
console.log(`[n8n-deploy] Remote workflow: ${remote.name ?? remote.data?.name ?? "(unknown)"}`);
console.log(`[n8n-deploy] Remote active: ${remote.active ?? remote.data?.active ?? "(unknown)"}`);

if (!shouldPush) {
	console.log("[n8n-deploy] Remote check complete. Pass --push to update n8n.");
	process.exit(0);
}

const updatePayload = {
	name: workflow.name,
	nodes: workflow.nodes,
	connections: workflow.connections,
	settings: workflow.settings ?? {},
	staticData: workflow.staticData ?? null,
};

console.log("[n8n-deploy] Updating remote workflow...");
await api(`/api/v1/workflows/${workflowId}`, {
	method: "PUT",
	body: JSON.stringify(updatePayload),
});
console.log("[n8n-deploy] Update complete.");

if (shouldActivate) {
	console.log("[n8n-deploy] Activating workflow...");
	await api(`/api/v1/workflows/${workflowId}/activate`, { method: "POST" });
	console.log("[n8n-deploy] Activated.");
}

console.log("[n8n-deploy] Done.");
