const ACK_ENDPOINT = "/api/ack";
const API_TOKEN_KEY = "authToken";

const connectSseButton = document.getElementById("connect-sse");
const disconnectSseButton = document.getElementById("disconnect-sse");
const connectWsButton = document.getElementById("connect-ws");
const disconnectWsButton = document.getElementById("disconnect-ws");
const clearLogButton = document.getElementById("clear-log");
const logNode = document.getElementById("log");

if (!connectSseButton || !disconnectSseButton || !connectWsButton || !disconnectWsButton || !clearLogButton || !logNode) {
  throw new Error("receiver ui elements missing");
}

let sse = null;
let ws = null;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logNode.textContent = `${line}\n${logNode.textContent}`;
  console.log(line);
}

function getAuthToken() {
  const token = localStorage.getItem(API_TOKEN_KEY)?.trim();
  return token || null;
}

function authHeaders(base = {}) {
  const token = getAuthToken();
  if (!token) return base;
  return {
    ...base,
    authorization: `Bearer ${token}`,
  };
}

async function postAck(alert, transport) {
  if (!alert || typeof alert.alertId !== "string" || typeof alert.serverTimestamp !== "number") {
    return;
  }

  const response = await fetch(ACK_ENDPOINT, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      alertId: alert.alertId,
      transport,
      receivedAtClient: Date.now(),
      serverTimestamp: alert.serverTimestamp,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ack failed (${response.status}) ${detail}`);
  }
}

function connectSse() {
  if (sse) {
    log("SSE already connected");
    return;
  }

  const token = getAuthToken();
  const sseUrl = token ? `/api/sse?token=${encodeURIComponent(token)}` : "/api/sse";
  sse = new EventSource(sseUrl);
  log("SSE connecting");

  sse.addEventListener("open", () => log("SSE open"));
  sse.addEventListener("error", () => log("SSE error"));

  sse.addEventListener("hello", (event) => {
    log(`SSE hello ${event.data}`);
  });

  sse.addEventListener("alert", async (event) => {
    try {
      const payload = JSON.parse(event.data);
      log(`SSE alert ${payload.alertId}`);
      await postAck(payload, "SSE");
      log(`SSE ACK sent ${payload.alertId}`);
    } catch (error) {
      log(`SSE alert handling failed: ${String(error)}`);
    }
  });
}

function disconnectSse() {
  if (!sse) {
    log("SSE already disconnected");
    return;
  }
  sse.close();
  sse = null;
  log("SSE disconnected");
}

function connectWs() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    log("WS already connected");
    return;
  }

  const token = getAuthToken();
  const wsPath = token ? `/api/ws?token=${encodeURIComponent(token)}` : "/api/ws";
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${wsPath}`);
  log("WS connecting");

  ws.addEventListener("open", () => log("WS open"));
  ws.addEventListener("close", () => log("WS closed"));
  ws.addEventListener("error", () => log("WS error"));

  ws.addEventListener("message", async (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.event === "hello") {
        log(`WS hello ${payload.connectedAt}`);
        return;
      }

      log(`WS alert ${payload.alertId}`);
      await postAck(payload, "WS");
      log(`WS ACK sent ${payload.alertId}`);
    } catch (error) {
      log(`WS message handling failed: ${String(error)}`);
    }
  });
}

function disconnectWs() {
  if (!ws) {
    log("WS already disconnected");
    return;
  }
  ws.close();
  ws = null;
  log("WS disconnect requested");
}

connectSseButton.addEventListener("click", connectSse);
disconnectSseButton.addEventListener("click", disconnectSse);
connectWsButton.addEventListener("click", connectWs);
disconnectWsButton.addEventListener("click", disconnectWs);
clearLogButton.addEventListener("click", () => {
  logNode.textContent = "";
  log("log cleared");
});
