# IntelliTender Project Notes

This is the main project guide. It explains the implemented system, the role boundaries, the end-to-end workflow, local AI setup, document processing, scoring, chatbot retrieval, and research metrics. File names below are relative to the repository root.

## 1. What IntelliTender does

IntelliTender is a procurement and tender-management platform with four user roles:

- CPO: organisation-wide procurement oversight and administration.
- PO: Procurement Officer who creates tenders, manages bids, committees, contracts, and AI processing.
- Committee: committee member who evaluates bids and monitors assigned contract milestones.
- Vendor: bidder who finds published tenders, submits bids, and sees only their own bid and contract information.

The normal business lifecycle is:

1. A PO or CPO creates a tender and adds requirements, documents, evaluation rules, and milestones.
2. The tender is published.
3. Vendors view published tenders and submit bid documents and a proposed amount.
4. Committee members evaluate bids using technical and financial marks.
5. AI can inspect the tender and bid documents and produce a separate auditable bid summary.
6. A PO or CPO selects a winner and the tender becomes awarded.
7. A contract is created, its milestones are updated by the committee/PO, and progress reports and evidence are stored.
8. AI can review milestone evidence for delay, checklist, quality, clause, and penalty risks.

The application has a React/Vite frontend, an Express/Mongoose backend, MongoDB persistence, and a locally hosted model server for chat and embeddings.

## 2. Repository map

### Frontend

- `frontend/src/main.tsx`: React entry point and optional Google OAuth provider.
- `frontend/src/app/App.tsx`: mounts the router.
- `frontend/src/app/routes.ts`: route-to-page mapping.
- `frontend/src/app/api.ts`: shared fetch helper; attaches the JWT from localStorage and prefixes the API base URL.
- `frontend/src/app/components/layout/Sidebar.tsx`: role-specific navigation and vendor account-status restrictions.
- `frontend/src/app/components/pages/Cpo_pages`: CPO screens.
- `frontend/src/app/components/pages/Po_pages`: PO screens, including AI queue/results/settings/alerts.
- `frontend/src/app/components/pages/Commitee_member_pages`: committee screens.
- `frontend/src/app/components/pages/Vendor_pages`: vendor screens.
- `frontend/src/app/components/AIAssistant.tsx`: shared chat UI used by role dashboards.
- `frontend/src/imports/intellitender-system-overview.md`: knowledge document retrieved by the chatbot.

### Backend

- `backend/index.js`: Express startup, MongoDB connection, routes, document worker, and periodic auto-scoring.
- `backend/models/model.js`: Mongoose schemas and indexes.
- `backend/middleware/auth.js`: JWT verification and route-level role checks.
- `backend/controllers`: authentication, tender, contract, admin, and mock business logic.
- `backend/routes`: HTTP route declarations and role middleware.
- `backend/AI/localModelClient.js`: local OpenAI-compatible/native model client, model discovery, token telemetry, and GPU power sampling.
- `backend/AI/chatbot`: intent classification, role-scoped retrieval, context construction, and chat lifecycle.
- `backend/AI/documents`: text extraction, durable chunk/embedding jobs, hybrid document search, and the worker.
- `backend/AI/evaluation`: bid scoring and milestone review services/controllers.
- `backend/utils/researchMetrics.js`: common research-event persistence helper.

## 3. Running the system locally

### Prerequisites

- Node.js with npm.
- MongoDB available locally or through the configured `MONGODB_URI`.
- A local model server such as LM Studio or Ollama.
- For PDF OCR fallback: `pdftoppm` must be available on PATH.
- `backend/eng.traineddata` is used by the Tesseract setup for English OCR.

### Start commands

Backend:

```powershell
cd backend
npm install
npm start
```

Development mode uses `npm run dev` and Node's watch mode. The API defaults to `http://localhost:5000`.

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

The repository also contains `start-intellitender.bat` for the project's local startup workflow.

### Local AI setup

The backend defaults to `http://localhost:1234/v1`, which matches the LM Studio server. The model server should expose a chat model and an embedding model. The default names are:

- Chat: `qwen3.5:9b` unless `LM_STUDIO_MODEL` or `OLLAMA_MODEL` is set.
- Chat override: `LM_STUDIO_CHAT_MODEL`.
- Embeddings: `bge-m3` unless `LM_STUDIO_EMBED_MODEL` or `OLLAMA_EMBED_MODEL` is set.
- URL: `LM_STUDIO_URL`, then `LOCAL_AI_URL`, then `http://localhost:1234/v1`.
- Optional key: `LM_STUDIO_API_KEY`, `LOCAL_AI_API_KEY`, or `OLLAMA_AUTH_TOKEN`.

`localModelClient.js` normalizes a base URL to end in `/v1`, discovers `/models`, separates embedding models from chat models, caches the model list for five minutes, and falls back to an available compatible model. It tries the native LM Studio v1 chat API when requested and also supports `/chat/completions` compatibility calls. JSON response formats are normalized for servers with different support levels.

Useful environment controls include:

- `LM_STUDIO_TIMEOUT_MS` or `OLLAMA_TIMEOUT_MS`: chat timeout, default 60 seconds.
- `LM_STUDIO_CHAT_MAX_TOKENS`: chatbot output cap, default 1200.
- `AI_SCORING_MAX_TOKENS`: bid scoring output cap, default 900 in the example configuration.
- `AI_MILESTONE_MAX_TOKENS`: milestone output cap, default 2200.
- `AI_AUTO_RUN_ENABLED=false`: disable automatic bid scoring.
- `AI_AUTO_RUN_INTERVAL_MS`: automatic scoring interval, default 120000 ms.
- `DOCUMENT_EMBED_WORKER_INTERVAL_MS`: document worker interval, default 15000 ms.
- `RESEARCH_GPU_TELEMETRY=false`: disable NVIDIA power sampling.

The `.env` file is local configuration and should not be committed. `.env.example` documents the main AI scoring context controls.

## 4. Authentication and role-based access control

### Login

1. The frontend sends credentials to `POST /api/auth/login` (or Google login to `POST /api/auth/google`).
2. The backend validates the user and password, then signs a JWT containing the user id and role.
3. The frontend stores the token and user information.
4. `api.ts` sends `Authorization: Bearer <token>` on subsequent requests.
5. `auth.js` verifies the JWT and rejects missing/invalid tokens with 401. If a route declares allowed roles and the token role is absent, it returns 403.

Passwords are hashed with bcrypt. Password reset and change-password flows use OTP fields stored on the user record. Vendor signup is separate from staff registration.

### Two layers of authorization

1. Route authorization: route declarations use `auth('CPO')`, `auth(['PO', 'CPO'])`, and similar checks.
2. Data authorization: controllers and chatbot retrieval apply user-specific MongoDB filters before returning records.

The frontend sidebar is only a navigation convenience; it is not the security boundary. The backend must be trusted as the authorization boundary.

### Role capabilities

| Role | Main capabilities | Data scope |
| --- | --- | --- |
| CPO | Create/manage POs, view vendors, compare bids, manage contract status, organisation-wide analytics | All tenders, bids, contracts, and operational data |
| PO | Create/edit/publish/close tenders, create committee members, view vendor profiles, run AI scoring, select winners, manage contracts/milestones | Tenders created by that PO, their related bids/contracts, and assigned committee members |
| Committee | Evaluate bids, submit progress reports, update/verify milestones, inspect assigned evaluation data | Tenders created by the PO in `User.managerPo`; related bids and milestone scope |
| Vendor | Browse published tenders, submit/withdraw bids, search contracts, view own bids/contracts | Published tenders, own bid records, own contracts; no evaluation marks or committee comments |

Committee assignment is represented by `User.managerPo`. A committee chatbot query first loads that user's manager PO and scopes tenders by `Tender.createdBy = managerPo`. A committee member without a manager PO gets an empty scope.

Vendor chatbot and retrieval responses deliberately remove technical scores, financial scores, rankings, evaluation marks, and committee-only comments. Vendor contract and tender summaries are also reduced to vendor-visible fields.

### Important API groups

- `/api/auth`: registration, vendor signup, login, Google login, OTP reset, password changes.
- `/api/tenders`: tender CRUD, publication/closure, bid submission/withdrawal, committee evaluation, evaluated-bid views, winner selection.
- `/api/contracts`: contract views, status/timeline changes, milestone updates, progress reports, assets, delay analysis.
- `/api/admin`: PO and committee administration, vendor administration, CPO/PO analytics, research analytics.
- `/api/ai/documents`: document indexing status, rebuild/reparse/restart, progress, dashboard.
- `/api/ai`: chatbot sessions and messages.
- `/api/ai/evaluations`: bid AI queue, per-bid reruns, queue state and results.
- `/api/ai/milestones`: milestone AI review endpoints.

The current route file should be checked when adding a new screen because some pages are compatibility aliases (`/bidder/*` maps to vendor pages). The frontend route map itself does not enforce role access; API checks and controller scopes do.

## 5. MongoDB data model

Core collections/models include:

- `User`: identity, role, hashed password, department, designation, `managerPo`, account status, OTP fields.
- `Tender`: title, description, category, budget, dates, status, creator, documents, required documents, evaluation method, QCBS/L1 configuration, embedded bids, draft milestones, and AI queue state.
- Embedded `Bid`: vendor identity, proposed amount, proposal/bid documents, status, committee evaluations, aggregated technical/financial marks, comments, evaluator metadata.
- `BidDocument`: larger vendor files stored separately from the tender document to avoid MongoDB document-size pressure.
- `Contract`: tender/vendor references, status, timeline, embedded milestones, embedded progress reports, and AI summary fields.
- `MilestoneAsset`: milestone/report attachments stored independently and referenced by id.
- `AIBidSummary`: one auditable AI evaluation per tender/bid, including eligibility, criteria marks, commercial analysis, risks, rationale, rank, model, prompt version, evaluation trace, and telemetry.
- `AIMilestoneReport`: one report per contract/milestone, including timeline, checklist summary, observations, alerts, severity, penalty estimate, and AI assessment.
- `AINotification`: alerts for PO users, especially milestone alerts.
- `AIChatSession`: user-owned conversation history and message metadata.
- `DocumentEmbeddingJob`: durable extraction/chunking/embedding job state.
- `DocumentChunk`: extracted chunk text, source metadata, token count, OCR flag, vector, and embedding model.
- `ResearchMetricEvent`: event-level timing, status, value, actor/scope identifiers, and metadata.

Bids are embedded in a tender for atomic workflow access. Large bid files and milestone assets use separate collections. Stored documents are commonly JSON strings containing `name`, `content`, and `mimeType`; legacy data URLs, URLs, and raw strings are also decoded.

## 6. Tender and contract workflow

### Tender and bid workflow

1. PO/CPO creates a draft tender.
2. Tender requirements and documents are saved.
3. PO/CPO publishes it.
4. Vendor sees it only when published and submits a bid.
5. Committee members evaluate the bid and their evaluations are stored inside the bid.
6. PO/CPO can run queued or per-bid AI evaluation.
7. The system aggregates/refreshes scores and ranks AI summaries.
8. PO/CPO selects a winner.
9. A contract is created and monitored.

A tender can use QCBS or L1:

- QCBS combines technical quality and commercial price using configured weights.
- L1 is price-led, but technical cutoff rules can still reject bids that do not meet the configured technical minimum.

### Contract and milestone workflow

PO/CPO can update contract status and define its timeline. Committee/PO/CPO can update milestones. Committee, PO, CPO, and Vendor can submit progress reports according to the route policy, while visible contract data is filtered by role. Milestones contain dates, status, progress 0-100, checklist, remarks, verification data, attachments, and history snapshots.

A milestone AI review compares planned and actual dates, checklist state, committee/progress reports, tender clauses, contract timeline, and attachment evidence. Alerts are saved as `AINotification` records for the PO.

## 7. Document extraction, chunking, and embeddings

### Extraction

`documentTextExtractor.js` handles the stored document formats:

- PDF: first tries `pdf-parse`; if text is empty, short for its page count, or OCR is forced, renders pages with `pdftoppm` and runs Tesseract.js English OCR.
- Image: runs Tesseract.js OCR and never decodes image bytes as UTF-8 fallback text.
- Other files: decodes the content as UTF-8 text.
- Data URLs, URLs, JSON document wrappers, and legacy raw strings are normalized before extraction.

Tesseract workers are lazily created and reused. `DOCUMENT_OCR_WORKERS` controls the pool and defaults to two. PDF temporary render directories are removed after extraction.

### What gets indexed

The worker seeds three source kinds:

- `tender-document`: tender documents.
- `bid-document`: separate vendor bid documents.
- `committee-report`: milestone assets and progress-report text.

A deterministic `sourceKey` identifies each source. SHA-1 content hashes prevent unchanged documents from being reprocessed. The pipeline version is `ocr-image-v3`, so extraction behavior changes can invalidate old jobs.

### Chunking algorithm

The current defaults are `DOCUMENT_EMBED_CHUNK_SIZE=2000` characters and `DOCUMENT_EMBED_CHUNK_OVERLAP=200`.

The implemented algorithm is paragraph-first:

1. Normalize carriage returns and collapse three or more newlines.
2. Split on blank lines into paragraphs.
3. Combine paragraphs while the combined text is within the chunk size.
4. Split an oversized paragraph into sentences using punctuation boundaries.
5. If an individual sentence is still too long, slice it into fixed-size pieces.
6. Persist each chunk with source ids, name, content hash, chunk hash, token count, and OCR flag.
7. Remove stale tail chunks after a document becomes shorter or settings change.

Important implementation detail: the `overlap` setting is accepted by the splitter and retained as configuration, but the current paragraph/sentence path does not add sliding-window overlap between normal chunks. Do not describe it as active overlap unless the implementation is changed.

### Embedding pipeline

The worker runs continuously after backend startup:

1. Seed jobs from MongoDB documents.
2. Extract text and persist chunks first, even if the local model is offline.
3. Check local AI health with a five-minute cache.
4. Embed pending chunks with `bge-m3` or the configured embedding model.
5. Mark each chunk and job complete only after its vector is saved.
6. Retry failed/stale jobs up to the configured job policy.
7. Trigger automatic AI bid scoring after document preparation when enabled.

For Nomic models, inputs are prefixed with `search_document:` or `search_query:`. Other embedding models receive normalized text directly. Embeddings are arrays of numbers stored in MongoDB; there is no external vector database.

## 8. Hybrid document search

The chatbot and milestone services use indexed documents when available. `searchDocumentChunks` applies role/source filters first, then searches up to the selected chunk limit.

The ranking score combines:

- cosine similarity between query and chunk embeddings;
- BM25-style lexical score with term frequency, length normalization (`k1=1.2`, `b=0.72`), and simple token-length IDF;
- exact query-bigram phrase hits;
- query-token coverage;
- a source-kind boost when the query names tender, bid, or report;
- an authority boost for words such as requirements, eligibility, criteria, compliance, and terms.

If query embedding fails, lexical ranking still works. Up to eight missing chunk vectors may be repaired opportunistically during search. Search returns source identity, score, excerpt, ids, chunk index, and MIME type for context grounding.

## 9. Chatbot design

The chatbot is implemented by `intentRouter.js`, `retrievalEngine.js`, `chatbotController.js`, and `localModelClient.js`.

### Request flow

1. Authenticate the chat request and load the user role.
2. Load/create the user's `AIChatSession`.
3. Classify the message using keyword-hit scores into structured, semantic, knowledge, tools, and documents branches.
4. Apply deterministic handlers for simple greetings/help and special procurement questions such as QCBS, award details, rejection reasons, fraud/genuity warnings, and name mismatches.
5. Load role-scoped MongoDB tenders, contracts, users, AI summaries, milestone reports, and relevant indexed document chunks.
6. Build a context digest containing schema guidance, local facts, structured matches, knowledge snippets, and document excerpts.
7. Build messages with a role instruction, context system message, answer-style system message, the last eight valid history entries, and the new user message.
8. Call the local chat model and collect telemetry.
9. Save the assistant answer and metadata in the chat session, then record a `chat-query` research event.

The assistant is instructed to answer from supplied records, avoid inventing MongoDB facts, respect the user's role, stay concise by default, and ask one clarifying question when context is insufficient.

### Intent classification

The router is not a trained classifier. It counts keyword hits. Structured terms include count/list/status/latest/budget/score/QCBS/L1; semantic terms include compare/why/reason/risk/recommend; knowledge terms include policy/workflow/how-to; tools terms include analytics/metrics/KPI/report; document terms include PDF/OCR/attachment/evidence. Ties are resolved by score order, and related branches are added so one query can retrieve multiple context types.

### Role-scoped chatbot data

- CPO: all tenders, bids, contracts, committee/vendor summaries, and operational facts.
- PO: tenders created by the current PO, their bids/contracts, and committee members managed by them.
- Committee: tenders created by the manager PO, associated bids/contracts, and committee-scope reports.
- Vendor: published tenders, their own bids/contracts, and public requirements; never committee marks or private evaluation comments.

The chatbot has deterministic answers for several sensitive or high-value questions. For example, award calculations can normalize technical marks and commercial price, explain rejected bids, and perform a score-based fairness comparison. The fairness message is explicitly not a legal finding.

## 10. AI bid evaluation

### Inputs and document gate

`aiScoringService.js` directly extracts tender and bid documents for scoring; scoring does not wait for the background embedding worker. It limits ordinary text to 1,800 characters per document, commercial text to 2,400 characters, up to eight documents per side, and approximately 16,000 total context characters by default. Commercial documents and schedule/methodology evidence are prioritized.

Before calling the model, the service checks that tender and bid documents are readable and that mandatory commercial/eligibility documents exist. A failed gate returns an ineligible summary and zero scores unless an explicit PO override is active.

### Model output

The local model is asked for strict JSON containing:

- `eligibility.passed` and reasons;
- criterion-level marks, maximum marks, rule type, document label, and evidence;
- commercial stated/adjusted values, rationale, and risks;
- genuity warnings and confidence;
- technical, financial, and overall AI scores;
- short summary and rationale.

Invalid JSON is retried once with a stricter prompt. If it still cannot be parsed, no normal AI decision is saved and the queue records failure. Post-processing repairs false missing-document claims, ensures configured criteria exist, applies tender text requirements, and prevents commercial scoring when eligibility failed unless overridden.

### Score formulas

Technical score is recalculated from criteria, not blindly trusted from the model:

$$
TechnicalScore = 100 \times \frac{\sum AwardedMarks}{\sum MaxMarks}
$$

Marks are clamped between zero and each criterion's maximum. For a configured QCBS tender:

$$
OverallScore = \frac{TechnicalScore \times TechnicalWeight + FinancialScore \times CommercialWeight}{TechnicalWeight + CommercialWeight}
$$

Weights default to 50/50 only when valid weights are absent. For QCBS commercial scoring, the lowest valid eligible price receives the highest normalized financial score and higher prices receive proportionally lower scores. For L1, price is the primary selection rule, with the tender's technical cutoff still applied where configured. Ineligible bids receive zero commercial marks unless the PO explicitly uses the eligibility override.

The server refreshes AI ranks after each saved summary. Human committee evaluations remain separate from AI summaries; the system does not silently replace committee marks.

### Queue and automation

Each tender has `aiEvaluationState` for idle/running/paused/completed progress, current bid, next index, totals, completed count, and last error. A map prevents duplicate scoring jobs for the same tender. The queue can start, pause, resume, retry, and score an individual bid. The backend also calls `runAutoAiScoring()` at startup and on an interval unless disabled.

## 11. AI milestone evaluation

`aiMilestoneService.js` builds a prompt from:

- tender metadata and extracted tender documents;
- contract status and timeline;
- milestone planned/actual dates, status, progress, checklist, and remarks;
- committee report and progress report;
- indexed attachments, or direct milestone asset extraction as fallback.

The model returns strict JSON with timeline/delay information, checklist summary, observations, alerts, severity, penalty estimate, summary, and an `aiAssessment` containing clause references, document signals, quality notes, penalty decision, backlog, questions, and comparison rows.

The model is told to compare every committee/progress statement against tender and contract evidence, cite identifiable clauses where possible, and never invent a penalty without a tender or contract basis. A saved report is linked uniquely by contract and milestone. Alerts create `AINotification` records for the PO.

## 12. Metrics, telemetry, and how values are calculated

There is no single universal AI accuracy metric in the current code. The system records event-level operational and comparison metrics in `ResearchMetricEvent`.

### Recorded event types

- `chat-query`: chatbot response duration and telemetry.
- `ai-bid-scoring`: one event per bid scoring attempt, success or failure.
- `committee-evaluation`: human committee evaluation timing.
- `milestone-ai-review`: milestone review timing and alert metadata.
- `document-chunking-batch`: OCR/extraction/chunk persistence batch counts.
- `document-embedding-batch`: embedding batch counts.

Low-level legacy `local-ai-inference` events are excluded from the main research feed and can be purged by the CPO endpoint.

### Admin research KPIs

The admin controller computes the following over the caller's tender scope:

- `aiEvaluationAvgMs`: average `durationMs` of successful `ai-bid-scoring` events.
- `committeeEvaluationAvgMs`: average `durationMs` of successful `committee-evaluation` events.
- `chatQueryAvgMs`: average `durationMs` of successful chat events for the actor when an actor filter is used.
- `bidsProcessedPerHour`: `3,600,000 / aiEvaluationAvgMs`; zero when no average exists.
- `aiCommitteeConsistency`: average similarity score between AI and committee technical/financial scores, expressed as 0-100.
- `errorCount`: failed AI summaries plus failed milestone reports plus failed non-legacy research events.
- `riskyItemsDetected`: AI genuity warnings plus commercial risks plus milestone alerts.

### AI/committee consistency formula

For each bid with both an AI summary and at least one committee evaluation:

1. Average committee technical marks.
2. Normalize them to 0-100 using the tender's total technical maximum, unless the tender has no criteria.
3. Compare with the AI technical score using absolute difference.
4. For QCBS, also compare average committee financial score with AI financial score.
5. Convert difference to similarity:

$$
Consistency = 100 - Difference
$$

For QCBS, the difference is the average of technical and financial absolute differences. For L1, only technical difference is used. The final KPI is the average of all comparable bids, rounded to two decimals. It is agreement/consistency, not proof that either evaluator is correct.

### Token, speed, and energy telemetry

`localModelClient.js` uses server-reported usage/statistics when available. If the local server reports no token usage, it estimates tokens as ceiling of non-empty character count divided by four and labels the source accordingly. It records prompt tokens, completion tokens, total tokens, generation time, time to first token, and tokens per second.

For bid scoring, the controller samples NVIDIA GPU power before and after evaluation using `nvidia-smi`. When both samples and generation time are available:

$$
AveragePowerWatts = \frac{PowerBefore + PowerAfter}{2}
$$

$$
EstimatedEnergyJoules = AveragePowerWatts \times GenerationTimeSeconds
$$

These are approximate host telemetry values, not a calibrated energy measurement. If `nvidia-smi` is unavailable or telemetry is disabled, power and energy are null.

### Document processing metrics

- Chunking batch `value` is the number of chunks created; metadata includes documents processed, failed, and source kinds.
- Embedding batch `value` is the number of chunks embedded; metadata includes pending/embedded/failed chunks and model.
- Bid and milestone event `value` is normally `1` per completed attempt; duration is the useful timing field.

## 13. Seed data and testing notes

`backend/scripts/seed.js` creates demo users, tenders, bids, contracts, and representative workflow data. It is useful for demonstrating each role and the AI paths. The backend package currently has no automated test suite (`npm test` prints that no tests are configured), so validation is primarily startup checks, API/manual workflow checks, and inspecting persisted MongoDB records.

For a reliable local demo, start MongoDB and the local model server first, seed the database, start the backend, wait for document preparation to run, then start the frontend. If the model is offline, OCR/chunk persistence can still complete; embeddings and model-dependent scoring/chat will wait or fall back where the code supports it.

## 14. Known implementation caveats

- Frontend routes are mappings, not a complete route guard; backend middleware and controller filtering are the real access controls.
- The document chunk overlap environment value is currently not applied as sliding overlap by the normal splitter.
- Token counts may be estimates when LM Studio/Ollama does not return usage statistics.
- GPU energy is estimated from two power samples and generation time.
- AI scores are recommendations and audit records; committee and PO decisions remain part of the workflow.
- Chat intent routing is keyword-based, not a learned classifier.
- Search has a lexical fallback when embeddings are unavailable.
- `backend/package.json` exposes `npm test` as a placeholder, so production confidence requires adding focused automated tests around authorization, scoring formulas, document extraction, and retrieval scope.

## 15. One-minute explanation

IntelliTender is a role-based procurement system where PO/CPO users publish tenders, vendors submit bids, committee members evaluate them, and awarded contracts are tracked through milestones. MongoDB stores the workflow and audit records. A local LM Studio/Ollama-compatible server provides chat, bid-scoring, milestone-review, and embedding models. Documents are decoded, extracted with PDF parsing or OCR, chunked and persisted, embedded locally, and searched with a hybrid vector/BM25-style ranker. AI scoring compares tender requirements with bid evidence, recalculates technical and weighted commercial scores, and saves its reasoning and telemetry. The chatbot retrieves only data permitted for the current role. Research dashboards calculate timing, throughput, risk, error, energy, and AI/committee consistency metrics from persisted events.
