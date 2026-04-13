# Experimental Design: PWA vs WhatsApp Disaster Alert Testing

This document outlines the user experience, experimental methodology, and metrics for comparing PWA (Web Push/SSE/WS) and WhatsApp (WAHA) distribution channels in a disaster alert context.

## 1. Research Objectives
- **Latency:** Compare the end-to-end time from report submission to device notification.
- **Reliability:** Measure delivery rates across different network conditions (Normal, 3G, 2G).
- **UX Clarity:** Evaluate the "time-to-action" for researchers during experimental runs.

## 2. System Architecture (Comparative)

### A. Distribution Channels
1. **PWA (SSE/WS):** Real-time persistent connection (Foreground).
2. **PWA (Web Push):** OS-level background notification (Background).
3. **WhatsApp:** Delivered via WAHA (WhatsApp HTTP API) + n8n workflow.

### B. Metric Collection (ACKs)
- **PWA:** Browser sends `POST /api/ack` with `receivedAtClient` timestamp.
- **WhatsApp:** WAHA Webhook `message.ack` sends `DELIVERED` status. The backend captures the webhook timestamp as `receivedAtClient`.

## 3. User Experience: Research Dashboard

A new administrative interface (`/admin/experiment`) for researchers to trigger and monitor trials.

### UI Components
- **Test Payload:** Default text: `!lapor ada lumba2 menggiring perahu di tepi pantai`.
- **Channel Gating:** Multi-select checkboxes for SSE, WS, PUSH, WA.
- **Network Profile:** Metadata tag for the run (e.g., `3G_R1`).
- **Real-time Timeline:**
  - `[0ms]` Alert Broadcast
  - `[45ms]` SSE Client A Received
  - `[120ms]` WS Client B Received
  - `[1500ms]` WA Group X Received (WAHA Delivered)
  - `[2200ms]` Push Client C Received

### Edge Case Handling in UI
- **Stale Clients:** Dashboard highlights clients that haven't sent a heartbeat in >60s.
- **WAHA Errors:** Displays WhatsApp API connection status (Session Connected/Disconnected).

## 4. Experimental Methodology

### Step 1: Baseline Setup
- **Server:** Backend running on a fixed environment (Docker).
- **Clients:** 
  - 3x PWA Receivers (Android/Chrome, iOS/Safari, Desktop/Edge).
  - 3x WhatsApp Receivers (Groups or Individual Chats).

### Step 2: Network Conditioning
Use network emulation on receiver devices:
- **Normal:** WiFi/4G (Low latency).
- **3G:** 768kbps, 100ms RTT.
- **2G:** 250kbps, 300ms RTT.

### Step 3: Trial Execution (Simultaneous)
1. Set the label (e.g., `comp_3g_r1`).
2. Trigger the "Lumba-lumba" alert from the Dashboard.
3. Wait for ACKs to settle (30-60s).
4. System automatically exports Redis streams to `experiments/stage6/<label>/raw/`.

### Step 4: Reproducibility & Documentation Standards
To ensure academic rigor, each run MUST include:
- **`run_manifest.json`**: Captured state of `ENABLE_X_DELIVERY` flags, backend version (git commit), and network profile.
- **`load.ndjson`**: The exact reports submitted (includes `clientReportId` and `createdAtClient`).
- **`alerts.ndjson`**: The fan-out events produced by the backend.
- **`acks.ndjson`**: All received ACKs (PWA manual ACKs + WA Webhook `message.ack`).

## 5. Metrics & Presentation for Paper

### A. Latency Analysis
- **Definition:** $L = T_{ack\_received} - T_{alert\_created}$.
- **Presentation:** Table of Mean, Median, P95, and Standard Deviation for each channel.
- **Visualization:** Cumulative Distribution Function (CDF) plot comparing SSE, WS, PUSH, and WA.

### B. Reliability & Delivery Rate
- **Metric:** $\text{Delivery Rate} = \frac{\text{Unique ACKs}}{\text{Unique Alerts Sent}}$.
- **Visualization:** Stacked bar charts showing "Immediate Delivery", "Delayed Delivery (>10s)", and "Missed".

### C. Resource Consumption
- **Metric:** CPU/RAM overhead per 1000 clients.
- **Presentation:** Comparative line chart showing backend resource spikes during fan-out.

## 6. Edge Cases & UX during Testing

| Edge Case | UX Handling | Metric Impact |
|-----------|-------------|---------------|
| **WA Throttling** | Dashboard shows "WA Delay" status. | Increases WA latency. |
| **Push Delay** | Log `FCM/APNS` handoff timestamp. | Differentiates Server->Push vs Push->Device delay. |
| **Offline Sync** | Mark ACK as `SYNCED` if received via Stage 5 logic. | Excluded from real-time latency, included in delivery rate. |

## 7. Canonical Alert Format
Researchers MUST use the following format for all valid "Lumba-lumba" trials:
`!lapor ada lumba2 menggiring perahu di tepi pantai`

*This format triggers the high-risk classification in the ML mock/actual, ensuring distribution is active.*
