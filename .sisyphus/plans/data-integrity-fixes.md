# Plan: Perbaikan Integritas Data Penelitian (Findings #1-#5)

## TL;DR

> Memperbaiki 5 temuan integritas data pada Distribution Hub agar metrik tesis (latency, delivery rate, sync success rate) valid dan konsisten.
>
> Deliverables:
> - Setup `bun test` + TDD harness
> - #1 Selaraskan enum status `reports:sync` antara `report.ts` dan `analyze.ts`
> - #2 Persist hasil Web Push ke stream `push:delivery`
> - #3 Log pengiriman WhatsApp terstruktur ke stream `whatsapp:send`
> - #4 Dokumentasi + clamp clock skew pada latency
> - #5 Propagasi `experimentId`: alertEvent -> client -> ACK
>
> Estimated Effort: Medium
> Parallel Execution: YES - 3 waves
> Critical Path: T1 (test setup) -> T2 (experimentId di alertEvent) -> T7 (ACK echo) -> Final QA

---

## Context

### Original Request
Membuat plan untuk memperbaiki temuan audit codebase (data-collection integrity) untuk tesis diseminasi peringatan dini multi-channel (Web Push + WhatsApp + offline PWA).

### Decisions (dari interview)
- Cakupan: Findings #1-#5 (KRITIS + TINGGI)
- Strategi tes: Setup `bun test` + TDD (RED-GREEN-REFACTOR)
- Enum status #1: selaraskan analyzer ke enum kode (TRIGGERED/QUEUED/DEDUPED/FAILED_ML)
- Clock skew #4: dokumentasikan sebagai keterbatasan + clamp nilai negatif

### Hidden Dependency (temuan saat audit)
`alertEvent` di `report.ts:202-221` TIDAK membawa `experimentId` (hanya ada di `input._experimentId`). Maka #5 butuh prasyarat: tambahkan `experimentId` ke `alertEvent` terlebih dulu, lalu di-echo client di ACK.

---

## Work Objectives

### Core Objective
Menjamin setiap kanal (Web Push, WhatsApp, SSE/WS, offline sync) menghasilkan log terstruktur yang konsisten sehingga metrik tesis dapat dihitung tanpa ambiguitas.

### Must Have
- Stream baru: `push:delivery`, `whatsapp:send`
- Enum status sync konsisten code <-> analyzer
- `experimentId` mengalir dari report -> alertEvent -> fan-out -> ACK
- `bun test` berjalan via `bun test`
- Analyzer meng-clamp latency negatif & mendokumentasikan asumsi

### Must NOT Have (Guardrails)
- JANGAN ubah bentuk `alertEvent` yang sudah dikonsumsi `history.ts`, SSE/WS fan-out, push payload (`sw.js`) secara breaking - hanya TAMBAH field opsional
- JANGAN rusak logika dedupe (`report.ts:89-135`)
- JANGAN ganti library Redis ke Bun.redis (di luar lingkup; codebase pakai `redis` npm)
- JANGAN ubah perilaku threshold crowdsource
- JANGAN hapus dukungan baca artifact lama tanpa mencatatnya

---

## Verification Strategy

> ZERO HUMAN INTERVENTION - semua verifikasi via agen.

### Test Decision
- Infrastructure exists: NO -> akan di-setup
- Automated tests: YES (TDD)
- Framework: `bun test`
- Pola: RED (test gagal) -> GREEN (impl minimal) -> REFACTOR

### QA Policy
Setiap task punya QA scenario agen. Evidence ke `.sisyphus/evidence/`.
- Backend logging: Bash (redis-cli XRANGE / curl /api/report)
- Analyzer: Bash (bun run script + cek output file)
- Client: inspeksi statis + unit test util

---

## Execution Strategy

```
Wave 1 (foundation - mulai segera):
- T1: Setup bun test harness [quick]
- T3: Fix #1 enum status analyzer [quick]
- T4: Fix #2 push:delivery stream [unspecified-high]
- T5: Fix #3 whatsapp:send stream [unspecified-high]
- T6: Fix #4 clock skew clamp + docs [quick]

Wave 2 (butuh fondasi experimentId):
- T2: #5a tambah experimentId ke alertEvent [deep]

Wave 3 (butuh T2):
- T7: #5b client echo experimentId di ACK + ack.ts simpan [unspecified-high]
- T8: #5c analyzer pakai experimentId konsisten [quick]

Wave FINAL:
- F1: Plan compliance audit (oracle)
- F2: Code quality + bun test (unspecified-high)
- F3: Real QA - kirim report, cek semua stream (unspecified-high)
- F4: Scope fidelity check (deep)

Critical Path: T1 -> T2 -> T7 -> T8 -> Final
```

---

## TODOs

- [x] 1. Setup `bun test` harness

  **What to do**:
  - Tambahkan script `"test": "bun test"` ke `package.json` (saat ini tidak ada).
  - Buat folder `src/__tests__/` dan satu test sanity `setup.test.ts` yang `expect(1+1).toBe(2)` untuk memverifikasi runner.
  - Buat helper test Redis: util kecil yang connect ke Redis (pakai `REDIS_URL`, default `redis://localhost:6379`) dan helper `readStreamJson(stream)` untuk XRANGE + parse field `json` (dipakai test task lain).
  - Pastikan `bunx tsc --noEmit` tetap bersih.

  **Must NOT do**:
  - Jangan tambahkan dependency test eksternal (jest/vitest) - gunakan `bun test` bawaan.
  - Jangan ubah `tsconfig.json` selain bila benar-benar perlu untuk test.

  **Recommended Agent Profile**:
  - Category: `quick` - setup tooling sederhana, satu file config + dua file test.
  - Skills: [] - tidak ada skill khusus diperlukan.

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 1
  - Blocks: T3, T4, T5, T6 (mereka menulis test)
  - Blocked By: None

  **References**:
  - `package.json:6-18` - lokasi blok scripts; ikuti gaya script `stage6:*` yang ada.
  - `AGENTS.md` (Bun Conventions) - "Use `bun test`"; jangan pakai jest/vitest.
  - `src/lib/redis.ts:1-22` - pola `createClient({ url: REDIS_URL })`; test helper tiru pola ini tapi pakai client terpisah agar bisa di-close.
  - `scripts/stage6/export-streams.ts:47-107` - pola parse XRANGE reply + field `json`; reuse logika ini di helper test.

  **Acceptance Criteria**:
  - [ ] `package.json` punya script `test`
  - [ ] `bun test` -> PASS (minimal 1 test sanity)
  - [ ] `bunx tsc --noEmit` -> tidak ada error

  **QA Scenarios**:
  ```
  Scenario: bun test berjalan
    Tool: Bash
    Steps:
      1. Jalankan `bun test`
      2. Assert exit code 0 dan output memuat "1 pass"
    Expected Result: runner hijau
    Evidence: .sisyphus/evidence/task-1-bun-test.txt

  Scenario: type check bersih
    Tool: Bash
    Steps:
      1. Jalankan `bunx tsc --noEmit`
      2. Assert exit code 0
    Expected Result: tidak ada type error
    Evidence: .sisyphus/evidence/task-1-tsc.txt
  ```

  **Commit**: YES - `chore(test): add bun test harness and redis test helper`

- [x] 2. [#5a Fondasi] Tambahkan `experimentId` ke `alertEvent`

  **What to do**:
  - Di `report.ts`, ekstrak `experimentId` dari `input._experimentId` (string opsional) dan sertakan sebagai field top-level OPSIONAL di `alertEvent` (mis. `alertEvent.experimentId = input._experimentId ?? null`).
  - Pastikan field ini ikut ter-serialize ke `alerts:stream` dan ter-publish ke `alerts:high` (otomatis karena `alertJson` di-stringify dari `alertEvent`).
  - Tambahkan `experimentId` ke `types.ts` bila ada tipe `alertEvent` yang dideklarasikan (saat ini `alertEvent` adalah object literal; tambahkan komentar/tipe bila perlu).
  - Tulis test (RED dulu): kirim report dengan `_experimentId` -> alertEvent hasil memuat `experimentId` yang sama.

  **Must NOT do**:
  - JANGAN ubah field `alertEvent` lain (`eventType`, `alertId`, `client`, `decision`, `input`, `ml`) - hanya TAMBAH.
  - JANGAN buat `experimentId` wajib - harus opsional/null agar report normal tetap jalan.
  - JANGAN ubah logika threshold/dedupe.

  **Recommended Agent Profile**:
  - Category: `deep` - menyentuh jalur data inti; harus paham downstream (history.ts, push.ts, sw.js) agar tidak breaking.
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: NO (fondasi untuk T7)
  - Parallel Group: Wave 2
  - Blocks: T7, T8
  - Blocked By: T1

  **References**:
  - `src/routes/report.ts:202-221` - definisi object `alertEvent`; tambahkan field di sini.
  - `src/routes/report.ts:232-250` - logika `_channel`/`_experimentId` & stream `experiments:triggers`; konsisten dengan penamaan.
  - `src/types.ts:11-20` - `PredictionInput._experimentId` sudah ada; rujuk.
  - `src/routes/history.ts:73-94` - konsumen `alertEvent`; pastikan penambahan field tidak mengganggu filter `client`/`decision`.
  - `src/lib/push.ts:87-92` - payload push memuat `alertEvent`; field baru akan ikut, pastikan `sw.js` tidak error (hanya baca `alertId`/`serverTimestamp`).

  **Acceptance Criteria**:
  - [ ] Test: report dengan `_experimentId="EXP-001"` -> `alertEvent.experimentId === "EXP-001"`
  - [ ] Test: report tanpa `_experimentId` -> `alertEvent.experimentId === null`
  - [ ] `bun test` + `bunx tsc --noEmit` hijau

  **QA Scenarios**:
  ```
  Scenario: experimentId masuk alertEvent
    Tool: Bash (curl + redis-cli)
    Preconditions: backend + redis + ML mock berjalan, threshold tercapai
    Steps:
      1. curl POST /api/report dengan body memuat _experimentId dan lik_codes cukup utk trigger
      2. redis-cli XREVRANGE alerts:stream + - COUNT 1
      3. Assert field json memuat "experimentId":"EXP-001"
    Expected Result: alertEvent membawa experimentId
    Evidence: .sisyphus/evidence/task-2-alertevent.txt

  Scenario: report normal tanpa experimentId tetap jalan
    Tool: Bash
    Steps:
      1. curl POST /api/report tanpa _experimentId
      2. Assert response ok dan alertEvent.experimentId null
    Evidence: .sisyphus/evidence/task-2-null.txt
  ```

  **Commit**: YES - `feat(report): carry experimentId into canonical alertEvent`

- [x] 3. [#1] Selaraskan enum status `reports:sync` di analyzer

  **What to do**:
  - Di `scripts/stage6/analyze.ts:166-177`, ganti perhitungan sync success agar memakai enum yang BENAR ditulis kode: sukses = `TRIGGERED + QUEUED + DEDUPED`, gagal = `FAILED_ML`.
  - Pertahankan kompat-mundur: jika ada artifact lama berisi `ACCEPTED`, hitung juga sebagai sukses (mapping `ACCEPTED -> sukses`) agar run lama tetap terbaca. Dokumentasikan di komentar.
  - `syncSuccessRate = (TRIGGERED+QUEUED+DEDUPED+ACCEPTED) / (semua status di denominator termasuk FAILED_ML)`.
  - Tulis test (RED): beri array event sync campuran -> assert successRate sesuai.

  **Must NOT do**:
  - JANGAN ubah enum yang ditulis `report.ts` (kode adalah acuan; analyzer yang menyesuaikan).
  - JANGAN hapus pembacaan `ACCEPTED` (kompat artifact lama).

  **Recommended Agent Profile**:
  - Category: `quick` - perubahan terlokalisir di satu fungsi analyzer.
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 1
  - Blocks: None
  - Blocked By: T1

  **References**:
  - `scripts/stage6/analyze.ts:166-177` - blok perhitungan `syncStatusCounts` & `syncSuccessRate` yang diperbaiki.
  - `src/routes/report.ts:151,278,94,182` - sumber kebenaran status: `QUEUED`, `TRIGGERED`, `DEDUPED`, `FAILED_ML`.
  - `experiments/stage6/ws_normal_r3/raw/report-sync-stream.ndjson` - contoh artifact lama berisi `ACCEPTED` (untuk uji kompat-mundur).

  **Acceptance Criteria**:
  - [ ] Test: {TRIGGERED:3, QUEUED:1, FAILED_ML:1} -> successRate = 0.8
  - [ ] Test: {ACCEPTED:50} (artifact lama) -> successRate = 1
  - [ ] Test: {} -> successRate = null
  - [ ] `bun test` hijau

  **QA Scenarios**:
  ```
  Scenario: analyzer hitung successRate dari enum kode
    Tool: Bash
    Steps:
      1. Siapkan fixture report-sync-stream.ndjson dengan status campuran
      2. bun run stage6:analyze -- --raw-dir=<fixture> --out-dir=<tmp>
      3. Assert summary.json sync.successRate sesuai ekspektasi
    Evidence: .sisyphus/evidence/task-3-analyzer.txt
  ```

  **Commit**: YES - `fix(analyze): align reports:sync status enum with backend`

- [x] 4. [#2] Persist hasil Web Push ke stream `push:delivery`

  **What to do**:
  - Modifikasi `sendPushAlertToAll` (`src/lib/push.ts:77-119`) agar selain return `{sent,removed,failed}`, ia menulis satu entri ringkasan ke Redis Stream `push:delivery` per broadcast: field `{ timestamp, alertId, experimentId, sent, removed, failed, totalSubscriptions }`.
  - Ambil `alertId` & `experimentId` dari `alertEvent` yang sudah di-parse di fungsi tersebut (baris 80-85). `experimentId` tersedia setelah T2.
  - Tambahkan konstanta `PUSH_DELIVERY_STREAM` di `src/config.ts` (default `push:delivery`, override via env).
  - Opsional granular: jika ingin per-subscription, tulis juga `push:delivery:detail` - TETAPI default cukup agregat per-alert (hindari over-engineering).
  - Tulis test (RED): mock/inject subscription -> panggil fungsi -> assert entri `push:delivery` tertulis dengan angka benar.

  **Must NOT do**:
  - JANGAN ubah bentuk payload push yang dikirim ke browser (`push.ts:87-92`).
  - JANGAN gagalkan broadcast jika XADD gagal - bungkus dalam try/catch, logging is best-effort.
  - JANGAN ubah logika penghapusan subscription 404/410.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - menyentuh jalur kirim push + config + test; perlu kehati-hatian agar tidak breaking.
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES (tidak bergantung T2 secara teknis; experimentId akan null bila T2 belum ada, tapi idealnya setelah T2)
  - Parallel Group: Wave 1
  - Blocks: None
  - Blocked By: T1

  **References**:
  - `src/lib/push.ts:77-119` - fungsi `sendPushAlertToAll`; tambahkan XADD sebelum return.
  - `src/index.ts:76-80` - pemanggil; saat ini hanya `console.log` hasil. Bisa tetap log, tapi sumber kebenaran kini stream.
  - `src/config.ts:17-25` - pola deklarasi konstanta stream (`ALERTS_STREAM`, `ACKS_STREAM`); tambahkan `PUSH_DELIVERY_STREAM` dengan pola sama.
  - `src/routes/report.ts:36` - pola `redis.xAdd(STREAM, "*", { json: JSON.stringify(event) })`; ikuti pola yang sama untuk konsistensi parsing oleh export-streams/analyze.

  **Acceptance Criteria**:
  - [ ] Test: 2 subscription valid -> entri push:delivery dengan sent=2
  - [ ] Test: XADD dibungkus try/catch (broadcast tidak gagal walau log gagal)
  - [ ] `bun test` + `bunx tsc --noEmit` hijau

  **QA Scenarios**:
  ```
  Scenario: hasil push tercatat di stream
    Tool: Bash (redis-cli)
    Preconditions: VAPID di-set, minimal 1 subscription tersimpan di alerts:push:subscriptions
    Steps:
      1. Trigger alert (curl /api/report sampai threshold)
      2. redis-cli XREVRANGE push:delivery + - COUNT 1
      3. Assert field memuat alertId, sent, removed, failed
    Expected Result: entri agregat push tercatat
    Evidence: .sisyphus/evidence/task-4-push-delivery.txt

  Scenario: push tanpa subscription tetap aman
    Tool: Bash
    Steps:
      1. Kosongkan hash subscription, trigger alert
      2. Assert push:delivery entri dengan sent=0 (atau tidak crash)
    Evidence: .sisyphus/evidence/task-4-empty.txt
  ```

  **Commit**: YES - `feat(push): persist push delivery results to push:delivery stream`

- [x] 5. [#3] Log pengiriman WhatsApp terstruktur ke stream `whatsapp:send`

  **What to do**:
  - Modifikasi `sendWAAlert` (`src/lib/waha.ts:3-31`) agar mencatat tiap percobaan kirim per `chatId` ke Redis Stream `whatsapp:send`: field `{ timestamp, chatId, status (SENT/FAILED), httpStatus, messageId, experimentId, error }`.
  - Coba ekstrak `messageId` dari response WAHA `sendText` (parse JSON response bila ada; WAHA umumnya mengembalikan id pesan). Jika tidak ada, set null.
  - Ubah signature `sendWAAlert(text)` agar menerima `experimentId?` opsional (caller di `report.ts:258-262` meneruskan `alertEvent.experimentId`).
  - Tambahkan konstanta `WA_SEND_STREAM` di `config.ts` (default `whatsapp:send`).
  - Import `redis` dari `./redis` di `waha.ts` (saat ini belum import redis).
  - Tulis test (RED): mock fetch sukses & gagal -> assert entri whatsapp:send sesuai status.

  **Must NOT do**:
  - JANGAN ubah endpoint/format request ke WAHA (`/sendText`, header `X-Api-Key`).
  - JANGAN gagalkan broadcast jika XADD gagal (best-effort, try/catch).
  - JANGAN ubah daftar `WAHA_BROADCAST_GROUPS`.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - menambah dependency redis ke modul waha + parsing response + test mock fetch.
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 1
  - Blocks: None
  - Blocked By: T1

  **References**:
  - `src/lib/waha.ts:3-31` - fungsi `sendWAAlert`; tambahkan logging + param experimentId.
  - `src/routes/report.ts:258-262` - pemanggil `sendWAAlert`; teruskan `alertEvent.experimentId` (tersedia setelah T2).
  - `src/routes/waha-webhook.ts:62-93` - pola stream WA yang sudah ada (`whatsapp:outgoing`, `whatsapp:acks`) - samakan gaya field (timestamp sebagai String).
  - `src/lib/redis.ts:4` - export `redis` client untuk di-import.
  - `src/config.ts:61-68` - blok konstanta WAHA; tambahkan `WA_SEND_STREAM` dekat sini.

  **Acceptance Criteria**:
  - [ ] Test: fetch ok -> entri whatsapp:send status=SENT, httpStatus=200
  - [ ] Test: fetch gagal -> entri status=FAILED dengan error
  - [ ] `bun test` + `bunx tsc --noEmit` hijau

  **QA Scenarios**:
  ```
  Scenario: pengiriman WA tercatat
    Tool: Bash (redis-cli)
    Preconditions: WAHA_API_KEY di-set (atau mock), trigger alert kanal non-WA
    Steps:
      1. Trigger alert via /api/report
      2. redis-cli XREVRANGE whatsapp:send + - COUNT 5
      3. Assert ada entri per chatId dengan status & httpStatus
    Evidence: .sisyphus/evidence/task-5-wa-send.txt

  Scenario: WAHA tidak dikonfigurasi -> skip tanpa crash
    Tool: Bash
    Steps:
      1. Kosongkan WAHA_API_KEY, trigger alert
      2. Assert tidak crash; tidak ada entri whatsapp:send (atau entri SKIPPED)
    Evidence: .sisyphus/evidence/task-5-skip.txt
  ```

  **Commit**: YES - `feat(waha): log whatsapp send attempts to whatsapp:send stream`

- [x] 6. [#4] Clamp clock skew + dokumentasi keterbatasan latency

  **What to do**:
  - Di `scripts/stage6/analyze.ts`, saat mengumpulkan `endToEndLatencyMs` (sekitar baris 149-155), buang/clamp nilai negatif: latency < 0 ditandai sebagai anomali (exclude dari statistik, tetapi hitung jumlahnya sebagai `negativeLatencyCount` di summary).
  - Tambahkan field `clockSkewNote` / `negativeLatencyCount` ke `summary.json` agar terdokumentasi di output.
  - Tambahkan catatan keterbatasan di `scripts/ANALYSIS_FORMAT.md` (dan/atau `docs/stage-6.md`): latency mengasumsikan jam client = jam server; tidak ada sinkronisasi NTP; nilai negatif di-exclude.
  - Tulis test (RED): array latency `[10, -5, 20]` -> statistik dihitung dari `[10,20]`, negativeLatencyCount=1.

  **Must NOT do**:
  - JANGAN ubah cara `ack.ts:44` menghitung `endToEndLatencyMs` (clamp dilakukan di analyzer, bukan di sumber, agar data mentah tetap utuh).
  - JANGAN hapus latency negatif dari stream mentah `alerts:acks` (raw data harus tetap apa adanya).

  **Recommended Agent Profile**:
  - Category: `quick` - perubahan terlokalisir di analyzer + dokumentasi.
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 1
  - Blocks: None
  - Blocked By: T1

  **References**:
  - `scripts/stage6/analyze.ts:149-163` - pengumpulan & summarize latency per transport; sisipkan filter clamp di sini.
  - `scripts/stage6/analyze.ts:61-76` - `summarizeNumbers`; pertimbangkan tambah count anomali di luar fungsi ini.
  - `src/routes/ack.ts:44` - sumber `endToEndLatencyMs` (JANGAN diubah, hanya rujuk untuk dokumentasi asumsi).
  - `scripts/ANALYSIS_FORMAT.md` - tempat menulis catatan keterbatasan.

  **Acceptance Criteria**:
  - [ ] Test: latency `[10,-5,20]` -> mean dihitung dari [10,20], negativeLatencyCount=1
  - [ ] summary.json memuat negativeLatencyCount
  - [ ] ANALYSIS_FORMAT.md memuat catatan asumsi clock skew
  - [ ] `bun test` hijau

  **QA Scenarios**:
  ```
  Scenario: analyzer clamp latency negatif
    Tool: Bash
    Steps:
      1. Siapkan fixture acks-stream.ndjson dengan satu endToEndLatencyMs negatif
      2. bun run stage6:analyze -- --raw-dir=<fixture> --out-dir=<tmp>
      3. Assert summary.json: nilai negatif tidak masuk min/mean, negativeLatencyCount=1
    Evidence: .sisyphus/evidence/task-6-clamp.txt
  ```

  **Commit**: YES - `fix(analyze): clamp negative latency and document clock-skew limitation`

- [x] 7. [#5b] Client echo `experimentId` di ACK + `ack.ts` menyimpannya

  **What to do**:
  - Tambahkan `experimentId?: string` ke tipe `AckInput` di `src/types.ts:29-37`.
  - Di `src/routes/ack.ts:39-47`, sertakan `experimentId` (dari input, default null) ke `ackEvent` yang ditulis ke `alerts:acks`.
  - Di `public/receiver.js:38-58` (`postAck`), ambil `alert.experimentId` dari payload alert dan kirim di body ACK untuk SSE & WS.
  - Di `public/sw.js:117-151` (push event & notificationclick), ambil `data.alertEvent?.experimentId` dan sertakan di body ACK DELIVERED & OPENED.
  - Tulis test (RED): ACK dengan experimentId -> entri alerts:acks memuat experimentId.

  **Must NOT do**:
  - JANGAN ubah perhitungan `endToEndLatencyMs` atau `ackKey`.
  - JANGAN buat experimentId wajib - ACK tanpa experimentId tetap valid (null).
  - JANGAN ubah validasi transport/timestamp yang sudah ada.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - menyentuh backend (ack.ts, types.ts) + 2 file client (receiver.js, sw.js); perlu konsistensi lintas-lapis.
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: NO
  - Parallel Group: Wave 3
  - Blocks: T8
  - Blocked By: T2 (alertEvent harus membawa experimentId dulu)

  **References**:
  - `src/types.ts:29-37` - tipe `AckInput`; tambahkan field opsional.
  - `src/routes/ack.ts:35-47` - bentuk `ackEvent`; sebar `experimentId`.
  - `public/receiver.js:38-52` - `postAck` SSE/WS; tambahkan experimentId dari payload.
  - `public/sw.js:105-133` - push event handler; `data.alertEvent.experimentId`.
  - `public/sw.js:135-160` - notificationclick; sertakan experimentId di ACK OPENED.
  - `scripts/analyze-whatsapp-webhooks.ts:235-276` - konsumen ACK by experimentId; ini yang akan tervalidasi oleh perubahan ini.

  **Acceptance Criteria**:
  - [ ] Test: POST /api/ack dengan experimentId -> entri alerts:acks memuat experimentId
  - [ ] Test: POST /api/ack tanpa experimentId -> experimentId null, tetap 200
  - [ ] `bun test` + `bunx tsc --noEmit` hijau

  **QA Scenarios**:
  ```
  Scenario: ACK membawa experimentId end-to-end
    Tool: Bash (curl + redis-cli)
    Steps:
      1. curl POST /api/ack body {alertId, transport:SSE, receivedAtClient, serverTimestamp, experimentId:"EXP-001"}
      2. redis-cli XREVRANGE alerts:acks + - COUNT 1
      3. Assert field json memuat "experimentId":"EXP-001"
    Evidence: .sisyphus/evidence/task-7-ack-expid.txt

  Scenario: ACK lama tanpa experimentId tetap diterima
    Tool: Bash
    Steps:
      1. curl POST /api/ack tanpa experimentId
      2. Assert 200 dan experimentId null
    Evidence: .sisyphus/evidence/task-7-ack-null.txt
  ```

  **Commit**: YES - `feat(ack): propagate experimentId from client ACK into alerts:acks`

- [x] 8. [#5c] Analyzer WhatsApp pakai `experimentId` konsisten

  **What to do**:
  - Verifikasi `scripts/analyze-whatsapp-webhooks.ts:235-276` (`readAcksFromRedis`) kini benar memfilter ACK by `experimentId` yang sudah tersedia (setelah T7).
  - Perbaiki matching latency PWA (`analyze-whatsapp-webhooks.ts:300-316`) agar mencocokkan trigger & ACK by `experimentId` + `alertId`, bukan asumsi entri pertama.
  - Tulis test (RED): fixture triggers + acks ber-experimentId -> pwaLatencyMs terhitung benar.

  **Must NOT do**:
  - JANGAN ubah format output `analysis.json` secara breaking (hanya pastikan field terisi benar).
  - JANGAN ubah skema stream WA.

  **Recommended Agent Profile**:
  - Category: `quick` - perbaikan logika matching di satu script + test.
  - Skills: []

  **Parallelization**:
  - Can Run In Parallel: NO
  - Parallel Group: Wave 3
  - Blocks: None
  - Blocked By: T7

  **References**:
  - `scripts/analyze-whatsapp-webhooks.ts:279-337` - `analyzeExperiment`; perbaiki matching.
  - `scripts/analyze-whatsapp-webhooks.ts:235-276` - `readAcksFromRedis`; bergantung experimentId dari T7.
  - `src/routes/report.ts:236-250` - stream `experiments:triggers` sumber `triggeredAt` & `experimentId`.

  **Acceptance Criteria**:
  - [ ] Test: trigger+ack ber-experimentId sama -> pwaLatencyMs = receivedAtClient - triggeredAt
  - [ ] Test: experimentId tidak match -> pwaLatencyMs null (bukan salah ambil entri lain)
  - [ ] `bun test` hijau

  **QA Scenarios**:
  ```
  Scenario: analyzer WA korelasi by experimentId
    Tool: Bash
    Steps:
      1. Siapkan manifest + stream fixture dengan 2 experimentId berbeda
      2. bun run scripts/analyze-whatsapp-webhooks.ts --run-id=<fixture>
      3. Assert analysis.json memetakan latency ke experimentId yang benar
    Evidence: .sisyphus/evidence/task-8-wa-analyze.txt
  ```

  **Commit**: YES - `fix(analyze-wa): correlate PWA/WA latency by experimentId`

---

## Final Verification Wave

- [x] F1. Plan Compliance Audit (oracle): verifikasi semua Must Have ada, Must NOT Have tidak dilanggar (cek history.ts/sw.js/SSE tidak breaking). **APPROVE**
- [x] F2. Code Quality (unspecified-high): `bunx tsc --noEmit` + `bun test` semua hijau; tidak ada `as any` baru. **PASS (tsc exit 0, 23 tests pass)**
- [x] F3. Real QA (unspecified-high): jalankan backend + redis + ML mock, kirim report PWA & WA, verifikasi entri di reports:sync, push:delivery, whatsapp:send, alerts:acks (dengan experimentId). **PASS (adapted: no live Redis -> pure-fn chain + mock-based stream-write tests; evidence task-F3-runtime-qa.txt)**
- [x] F4. Scope Fidelity (deep): tiap task 1:1 dengan diff; tidak ada perubahan di luar lingkup #1-#5. **APPROVE**

---

## Success Criteria

### Verification Commands
```bash
bun test                                   # semua test hijau
bunx tsc --noEmit                          # tidak ada type error
redis-cli XLEN push:delivery               # > 0 setelah push
redis-cli XLEN whatsapp:send               # > 0 setelah WA broadcast
bun run stage6:analyze -- --raw-dir=... --out-dir=...  # successRate != null
```

### Final Checklist
- [x] Semua Must Have terpenuhi
- [x] Semua Must NOT Have tidak dilanggar
- [ ] Semua test hijau
