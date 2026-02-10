import { createClient } from "redis";

type Args = {
  redisUrl: string;
  alertsStream: string;
  acksStream: string;
  reportSyncStream: string;
  dedupePrefix: string;
};

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function getArgs(): Args {
  return {
    redisUrl: getArg("redis-url") ?? process.env.REDIS_URL ?? "redis://localhost:6379",
    alertsStream: getArg("alerts-stream") ?? process.env.ALERTS_STREAM ?? "alerts:stream",
    acksStream: getArg("acks-stream") ?? process.env.ACKS_STREAM ?? "alerts:acks",
    reportSyncStream: getArg("report-sync-stream") ?? process.env.REPORT_SYNC_STREAM ?? "reports:sync",
    dedupePrefix: getArg("dedupe-prefix") ?? process.env.REPORT_DEDUPE_PREFIX ?? "reports:dedupe",
  };
}

async function run() {
  const args = getArgs();

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

  const streamDeleteCount = await client.del([
    args.alertsStream,
    args.acksStream,
    args.reportSyncStream,
  ]);

  const dedupePattern = `${args.dedupePrefix}:*`;
  let dedupeDeleteCount = 0;

  for await (const keys of client.scanIterator({ MATCH: dedupePattern, COUNT: 500 })) {
    if (!Array.isArray(keys) || keys.length === 0) continue;
    dedupeDeleteCount += await client.del(keys);
  }

  await client.close();

  console.log(
    `[stage6] reset complete streamsDeleted=${streamDeleteCount} dedupeKeysDeleted=${dedupeDeleteCount} pattern=${dedupePattern}`,
  );
}

run().catch((error) => {
  console.error("[stage6] reset fatal", error);
  process.exit(1);
});
