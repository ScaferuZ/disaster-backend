import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient } from "redis";

type RawStreamEntry = {
  id: string;
  fields: Record<string, string>;
  parsedJson: unknown | null;
};

type Args = {
  redisUrl: string;
  outDir: string;
  batchSize: number;
  alertsStream: string;
  acksStream: string;
  reportSyncStream: string;
};

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function parseNumberArg(name: string, fallback: number): number {
  const value = getArg(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid --${name}: ${value}`);
  }
  return parsed;
}

function getArgs(): Args {
  return {
    redisUrl: getArg("redis-url") ?? process.env.REDIS_URL ?? "redis://localhost:6379",
    outDir: getArg("out-dir") ?? "experiments/stage6/latest/raw",
    batchSize: parseNumberArg("batch-size", 500),
    alertsStream: getArg("alerts-stream") ?? process.env.ALERTS_STREAM ?? "alerts:stream",
    acksStream: getArg("acks-stream") ?? process.env.ACKS_STREAM ?? "alerts:acks",
    reportSyncStream: getArg("report-sync-stream") ?? process.env.REPORT_SYNC_STREAM ?? "reports:sync",
  };
}

function parseStreamReply(reply: unknown): RawStreamEntry[] {
  if (!Array.isArray(reply)) return [];

  const entries: RawStreamEntry[] = [];
  for (const row of reply) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const id = String(row[0]);
    const rawFields = row[1];
    if (!Array.isArray(rawFields)) continue;

    const fields: Record<string, string> = {};
    for (let idx = 0; idx < rawFields.length; idx += 2) {
      const field = rawFields[idx];
      const value = rawFields[idx + 1];
      if (field === undefined || value === undefined) continue;
      fields[String(field)] = String(value);
    }

    let parsedJson: unknown | null = null;
    if (typeof fields.json === "string") {
      try {
        parsedJson = JSON.parse(fields.json);
      } catch {
        parsedJson = null;
      }
    }

    entries.push({ id, fields, parsedJson });
  }

  return entries;
}

async function readWholeStream(
  client: ReturnType<typeof createClient>,
  stream: string,
  batchSize: number,
): Promise<RawStreamEntry[]> {
  const all: RawStreamEntry[] = [];
  let start = "-";

  while (true) {
    const reply = await client.sendCommand([
      "XRANGE",
      stream,
      start,
      "+",
      "COUNT",
      String(batchSize),
    ]);
    const entries = parseStreamReply(reply);
    if (entries.length === 0) break;

    all.push(...entries);
    const lastId = entries[entries.length - 1]?.id;
    if (!lastId) break;
    start = `(${lastId}`;
  }

  return all;
}

async function writeNdjson(path: string, rows: unknown[]) {
  await mkdir(dirname(path), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await Bun.write(path, body.length > 0 ? `${body}\n` : "");
}

async function run() {
  const args = getArgs();
  await mkdir(args.outDir, { recursive: true });

  const client = createClient({
    url: args.redisUrl,
    socket: {
      reconnectStrategy: false,
    },
  });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(`failed to connect redis at ${args.redisUrl}: ${String(error)}`);
  }

  const startedAt = Date.now();

  const alerts = await readWholeStream(client, args.alertsStream, args.batchSize);
  const acks = await readWholeStream(client, args.acksStream, args.batchSize);
  const sync = await readWholeStream(client, args.reportSyncStream, args.batchSize);

  await writeNdjson(`${args.outDir}/alerts-stream.ndjson`, alerts);
  await writeNdjson(`${args.outDir}/acks-stream.ndjson`, acks);
  await writeNdjson(`${args.outDir}/report-sync-stream.ndjson`, sync);

  await Bun.write(
    `${args.outDir}/export-meta.json`,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        redisUrl: args.redisUrl,
        streams: {
          alerts: args.alertsStream,
          acks: args.acksStream,
          reportSync: args.reportSyncStream,
        },
        counts: {
          alerts: alerts.length,
          acks: acks.length,
          reportSync: sync.length,
        },
        durationMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );

  await client.close();

  console.log(
    `[stage6] exported alerts=${alerts.length} acks=${acks.length} reportSync=${sync.length} outDir=${args.outDir}`,
  );
}

run().catch((error) => {
  console.error("[stage6] export fatal", error);
  process.exit(1);
});
