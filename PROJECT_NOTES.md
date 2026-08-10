# IntelliTender Project Notes

## 1. What the project does

IntelliTender is a role-based procurement platform for managing the full tender lifecycle:

- Tender creation and publication
- Bid submission by vendors
- Committee review and scoring
- AI-assisted evaluation and milestone analysis
- Contract creation and contract progress tracking
- Role-specific dashboards for CPO, PO, Committee, and Vendor users
- A built-in AI assistant for natural-language queries over procurement data

The app is split into a React frontend and an Express + MongoDB backend. The backend also includes a local AI integration layer that talks to a self-hosted model server.

## 2. High-level architecture

### Frontend

The frontend is a Vite + React + TypeScript app. It uses:

- `react-router` for routing
- local component state with React hooks
- a shared API helper for backend requests
- reusable layout components such as sidebar and header
- a common AI assistant widget shown across role pages

### Backend

The backend is an Express API with:

- JWT-based auth
- role-based access control
- MongoDB persistence through Mongoose
- tender, contract, admin, mock, and auth routes
- AI endpoints for chat, evaluation scoring, and milestone review

### AI layer

AI is not a third-party hosted SaaS integration here. The code points to a local model server such as LM Studio or Ollama through `backend/AI/localModelClient.js`. That client is used for:

- chat responses
- procurement query assistance
- bid evaluation scoring
- milestone analysis
- embedding calls when needed

## 3. Frontend structure

The main frontend entry points are:

- `frontend/src/main.tsx`
- `frontend/src/app/App.tsx`
- `frontend/src/app/routes.ts`

### App bootstrapping

`main.tsx` creates the React root and wraps the app in `GoogleOAuthProvider` when `VITE_GOOGLE_CLIENT_ID` is available. That means Google sign-in support is optional and environment-driven.

`App.tsx` is intentionally tiny. It just mounts the router through `RouterProvider`, so navigation is centralized in one place instead of being spread across the app.

### Routing

Routing is defined in `frontend/src/app/routes.ts` using `createBrowserRouter`.

Important route groups:

- Public: `/`, `/login`, `/change-password`
- CPO: `/cpo`, `/cpo/bidders`, `/cpo/bid-comparison`, `/cpo/contracts`, `/cpo/create-po`
- PO: `/po`, `/po/create-tender`, `/po/publish-tender`, `/po/evaluation`, `/po/ai-evaluation`, `/po/ai-alerts`, `/po/milestones`, `/po/create-committee`
- Committee: `/committee`, `/committee/evaluation`, `/committee/monitoring`, `/committee/milestones`
- Vendor: `/vendor`, `/vendor/contract-search`, `/vendor/bids`, `/vendor/contracts`
- Legacy compatibility: `/bidder/*` routes map to the vendor pages

This routing setup is simple but effective:

- each page is a route-backed screen
- role-based navigation is handled by the layout
- legacy paths are preserved so older links still work

## 4. How the frontend is organized

The frontend is grouped by feature and role:

- `components/layout` for global UI chrome such as sidebar and header
- `components/pages/Cpo_pages` for CPO screens
- `components/pages/Po_pages` for procurement officer screens
- `components/pages/Commitee_member_pages` for committee screens
- `components/pages/Vendor_pages` for vendor screens
- `components/ui` for shared UI primitives

This keeps the app easy to scan because the role a page belongs to is visible from the folder structure.

## 5. Hooks and frontend efficiency

The code uses React hooks in a practical, performance-aware way rather than over-engineering everything.

### Common hook patterns

- `useState` is used for local page state such as forms, loading flags, selected records, and modals
- `useEffect` is used to load data on mount or when a selected tender changes
- `useCallback` is used for async loader functions that are passed into effects, so dependencies stay stable
- `useMemo` is used to derive sorted lists, lookup maps, stats, and selected records without recomputing on every render

### Why this is efficient

The app avoids recomputing derived data inside render when it can be memoized.

Examples:

- tender lists are sorted in `useMemo`
- AI summaries are turned into a `Map` for constant-time lookups
- selected tender records are derived with `useMemo`
- vendor stats are aggregated once per data change

This reduces unnecessary rerenders and keeps larger screens responsive even when they are rendering multiple tables and summary panels.

### Example pattern

The PO AI evaluation screen uses:

- `useCallback` for `loadTenders`, `loadBids`, and `loadAiSummaries`
- `useEffect` to trigger those loads automatically
- `useMemo` to derive ranking, tender selection, and committee averages

That is a good pattern for this codebase because it separates:

- fetching state
- computed display state
- user actions

## 6. Shared API layer

Frontend requests go through `frontend/src/app/api.ts`.

That helper:

- reads the auth token from `localStorage`
- attaches `Authorization: Bearer <token>` automatically
- prefixes requests with `VITE_API_BASE_URL` or `http://localhost:5000`
- parses JSON and throws a typed `ApiError` on failure

This is the main reason the frontend can stay clean. Pages do not manually repeat fetch boilerplate or auth header logic.

## 7. Role-based layout

The sidebar in `frontend/src/app/components/layout/Sidebar.tsx` is role-aware.

It:

- changes the menu items based on user role
- highlights the active route using `useLocation`
- supports legacy bidder paths
- disables vendor actions when the vendor account is not active

So the app’s navigation is not hardcoded per page. It is centralized in one place and driven by role.

## 8. Tender data flow

### Where tenders live

Tenders are stored in MongoDB in the `Tender` collection.

The tender schema includes:

- title and description
- category
- budget
- pre-bid date
- final submission date
- evaluation method
- QCBS and L1 configuration
- required documents
- status
- AI evaluation state
- createdBy
- documents
- embedded bids
- draft milestones

### How tenders are loaded in the frontend

Most role pages call:

- `GET /api/tenders`

Then they filter in the browser according to the current role or the current user.

Examples:

- vendor screens show only published tenders
- PO AI screens show tenders created by the logged-in PO
- queue screens show the PO’s own tenders
- CPO screens can see broader procurement data

### How tender documents are stored

Document content is stored as a JSON string that contains:

- the filename
- the file content as a data URL or another stored reference
- the MIME type

The frontend encodes files with `frontend/src/app/document-utils.ts`, and the backend decodes and normalizes those documents before using them.

This design supports:

- uploads from the browser
- legacy string values
- direct stored data URLs
- document references that can be lazily resolved

### How bid documents are stored

Bids are embedded directly inside the tender document as an array.

Each bid can include:

- vendor identity
- proposed amount
- proposal document
- bid documents
- committee evaluations
- technical and financial scores
- status

This makes bid retrieval easy because the whole tender and its bids can be loaded together.

There is also a separate `BidDocument` collection for more structured document storage and retrieval.

## 9. Backend routes and tender workflow

The tender routes are defined in `backend/routes/tenderRoutes.js`.

Main actions:

- create tender
- list tenders
- fetch tender documents
- edit tender
- publish tender
- close tender
- submit bid
- list bids
- evaluate bid
- list evaluated bids
- select winner

The flow is:

1. PO or CPO creates a tender.
2. The tender is published.
3. Vendors browse published tenders and submit bids.
4. Committee members evaluate bids.
5. PO or CPO reviews the evaluated bids and selects a winner.
6. A contract is created and monitored through milestones.

## 10. How AI is integrated

AI is used in three main places:

1. Chat assistant
2. Bid evaluation
3. Milestone review

### 10.1 Chat assistant

The AI assistant is exposed through `/api/ai/chat` and chat session endpoints under `/api/ai/chats`.

The flow is:

- the frontend `AIAssistant` component opens and loads chat sessions
- the user sends a message
- the backend classifies the intent
- the backend gathers relevant records from MongoDB
- the local model gets a role-specific prompt plus context
- the response is stored in the chat session and returned to the frontend

Important parts:

- `backend/AI/chatbot/intentRouter.js` classifies the query into structured, semantic, knowledge, or tools-oriented branches
- `backend/AI/chatbot/retrievalEngine.js` gathers relevant tenders, contracts, users, and knowledge snippets
- `backend/AI/chatbot/chatbotController.js` manages the chat lifecycle and response assembly

The assistant is role-aware, so it answers differently for CPO, PO, Committee, and Vendor users.

### 10.2 Bid evaluation AI

Bid evaluation is handled through:

- `backend/AI/evaluation/aiScoringController.js`
- `backend/AI/evaluation/aiScoringService.js`

The process:

1. The tender and bid documents are collected.
2. PDFs and images are converted to text.
3. A strict JSON prompt is sent to the local model.
4. The model returns eligibility, criterion scores, commercial analysis, AI scores, rationale, and summary.
5. The result is stored in `AIBidSummary`.

The backend also tracks queue state inside the tender itself using `aiEvaluationState`, which means AI scoring can be:

- started
- resumed
- paused
- auto-run after deadline

That state machine is important because the PO queue screen can show live progress and resume interrupted evaluations.

### 10.3 Milestone AI

Milestone review is handled through:

- `backend/AI/evaluation/aiMilestoneController.js`
- `backend/AI/evaluation/aiMilestoneService.js`

The service:

- loads the tender, contract, milestone, and any attachments
- extracts text from uploaded evidence
- asks the local model to review delay risk, checklist completion, and penalty signals
- stores the result in `AIMilestoneReport`
- creates AI notifications when alerts are found

This is how the app turns milestone updates into actionable procurement warnings.

## 11. Local model integration

`backend/AI/localModelClient.js` is the abstraction around the local model endpoint.

It supports:

- chat completions
- embeddings
- model discovery and fallback
- model selection from env vars

The backend does not depend on a remote OpenAI API here. Instead it talks to a local server, which makes the project easier to run in a self-contained environment.

## 12. Database model summary

The main models are:

- `User`
- `Tender`
- `Contract`
- `BidDocument`
- `AIBidSummary`
- `AIMilestoneReport`
- `AINotification`
- `AIChatSession`
- `MilestoneAsset`

That structure supports:

- authentication and role management
- tender and bid lifecycle
- document storage
- AI audit trails
- milestone alerts
- conversational support

## 13. Seed data

`backend/scripts/seed.js` creates demo users, tenders, bids, and contracts.

It is useful because it gives the app realistic test data for:

- published tenders
- draft tenders
- closed/evaluated tenders
- awarded/completed contracts
- vendor histories
- AI evaluation examples
- milestone scenarios

The seeded documents are also stored in the same encoded format the app uses in production, so the document flow can be tested end to end.

## 14. What makes the React implementation efficient

The implementation is efficient mostly because it keeps concerns separated:

- routing is centralized
- data loading is done through a small shared API wrapper
- derived data is memoized
- loaders are stabilized with `useCallback`
- pages only request what they need
- AI processing happens on the backend, not inside the browser

This means the frontend stays mostly responsible for rendering and interaction, while the backend handles retrieval, scoring, and persistence.

## 15. Notes for presenting the project

If you are explaining the project in a viva or demo, a clean way to describe it is:

- IntelliTender is a role-based procurement platform
- the frontend is a React app with route-based dashboards
- tenders and bids are stored in MongoDB
- documents are encoded and decoded as stored data strings
- AI is integrated through a local model server
- chat, bid evaluation, and milestone monitoring all use AI
- the backend keeps AI outputs in the database for traceability

## 16. Short summary

In one sentence: IntelliTender combines procurement workflow management with role-based UI, embedded tender/bid storage, and local AI services for chat, evaluation, and monitoring.
