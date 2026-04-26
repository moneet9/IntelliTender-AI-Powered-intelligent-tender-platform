# IntelliTender Backend - Comprehensive Study Guide

## Table of Contents
1. [Database Schema](#database-schema)
2. [Authentication Flow](#authentication-flow)
3. [File Storage Architecture](#file-storage-architecture)
4. [Data Access Patterns](#data-access-patterns)
5. [API Endpoints Overview](#api-endpoints-overview)
6. [Key Concepts Q&A](#key-concepts-qa)

---

## 1. Database Schema

### 1.1 Core Collections

#### **User Schema**
```javascript
{
  name: String,
  email: String (unique),
  password: String (hashed),
  role: Enum(['CPO', 'PO', 'Committee', 'Vendor']),
  phone: String,
  department: String,
  specialization: String,
  designation: String,
  managerPo: ObjectId (ref: User) // Committee -> PO relationship
  accountStatus: Enum(['Active', 'Frozen', 'Suspended', 'Deleted']),
  frozenUntil: Date,
  passwordResetOtp: String,
  passwordResetOtpExpiresAt: Date,
  changePasswordOtp: String,
  changePasswordOtpExpiresAt: Date,
  pendingPasswordHash: String,
  timestamps: { createdAt, updatedAt }
}
```

**Key Points:**
- Role-based access control (RBAC)
- Committee members have `managerPo` linking to their assigned PO
- Account status for freeze/suspension logic
- Password reset flow with OTP

---

#### **Tender Schema**
```javascript
{
  title: String,
  description: String,
  category: Enum(['Supply', 'Work', 'Service', 'General']),
  budget: Number,
  deadline: Date,
  status: Enum(['Draft', 'Published', 'Closed', 'Awarded', 'Completed']),
  createdBy: ObjectId (ref: User) // PO or CPO
  documents: [String] // Array of stored document references
  bids: [BidSchema], // Embedded array
  draftMilestones: [{
    title: String,
    description: String,
    plannedStartDate: Date,
    plannedEndDate: Date,
    checklistItems: [String]
  }],
  timestamps: { createdAt, updatedAt }
}
```

**Key Points:**
- Bids are embedded (not separate collection) - keeps tender atomic
- Documents stored as strings (URLs or base64)
- Status lifecycle: Draft → Published → Closed → Awarded → Completed

---

#### **Bid Schema (Embedded in Tender)**
```javascript
{
  _id: ObjectId,
  vendorId: ObjectId (ref: User),
  vendorName: String,
  proposedAmount: Number,
  proposalDocumentId: ObjectId (ref: BidDocument), // Reference to separate collection
  proposalDocument: String, // Stringified JSON with {name, content, mimeType}
  status: Enum(['Pending', 'Evaluated', 'Selected', 'Rejected']),
  committeeEvaluations: [{
    committeeMemberId: ObjectId (ref: User),
    technicalScore: Number,
    financialScore: Number,
    comments: String,
    evaluatedDate: Date
  }],
  technicalScore: Number, // Aggregated
  financialScore: Number, // Aggregated
  comments: String,
  evaluatedBy: ObjectId (ref: User),
  evaluatedDate: Date,
  timestamps: { createdAt, updatedAt }
}
```

**Key Points:**
- Multiple committee members can evaluate same bid
- Scores are aggregated (average of all evaluations)
- Document reference (ID) stored separately from proposal content

---

#### **BidDocument Schema (Separate Collection)**
```javascript
{
  _id: ObjectId,
  tenderId: ObjectId (ref: Tender), // Indexed for fast lookup
  vendorId: ObjectId (ref: User),   // Indexed
  name: String,
  content: String, // Base64 or data: URL
  mimeType: String,
  timestamps: { createdAt, updatedAt }
}
```

**Why Separate?**
- Tender document size is limited (16 MB MongoDB limit)
- Bid files can be large (PDFs, images)
- Keeps tender queries fast (doesn't fetch large content)

---

#### **Contract Schema**
```javascript
{
  tenderId: ObjectId (ref: Tender),
  vendorId: ObjectId (ref: User),
  status: Enum(['Awarded', 'Signed', 'Completed', 'Cancelled']),
  timelineDefined: Boolean,
  timelineStartDate: Date,
  timelineEndDate: Date,
  milestones: [ContractMilestoneSchema], // Embedded
  progressReports: [ProgressReportSchema], // Embedded
  timestamps: { createdAt, updatedAt }
}
```

---

#### **MilestoneAsset Schema (NEW - Separate Collection)**
```javascript
{
  _id: ObjectId,
  contractId: ObjectId (ref: Contract), // Indexed
  milestoneId: ObjectId (optional),
  reportId: ObjectId (optional),
  uploadedBy: ObjectId (ref: User),
  assetType: Enum(['milestone-document', 'milestone-image', 'progress-report-attachment']),
  name: String,
  content: String, // Base64 encoded
  mimeType: String,
  timestamps: { createdAt, updatedAt }
}
```

**Why Separate?**
- Prevents contract document from exceeding 16 MB limit
- Multiple milestone/report attachments accumulate quickly
- Each file stored independently, referenced by ID

---

#### **ContractMilestone Schema (Embedded in Contract)**
```javascript
{
  _id: ObjectId,
  title: String,
  description: String,
  plannedStartDate: Date,
  plannedEndDate: Date,
  actualStartDate: Date,
  actualEndDate: Date,
  status: Enum(['Not Started', 'In Progress', 'Completed', 'Delayed']),
  progress: Number (0-100),
  assignedTo: String,
  checklist: [{
    label: String,
    checked: Boolean
  }],
  remarks: String,
  verifiedBy: ObjectId (ref: User),
  verifiedAt: Date,
  documents: [ObjectId], // Reference IDs to MilestoneAsset
  images: [ObjectId],    // Reference IDs to MilestoneAsset
  history: [MilestoneHistoryEntry],
  timestamps: { createdAt, updatedAt }
}
```

**Key Points:**
- Progress tracking with checklist
- Audit trail via history array
- Documents/images stored as ObjectIds (not content)

---

### 1.2 Relationships Diagram

```
User (CPO/PO)
  ├── creates → Tender
  │              └── bids (embedded) → BidDocument (separate)
  │              └── documents: [String]
  │
  └── awarded → Contract
                 ├── milestones (embedded)
                 │    └── documents: [ObjectId] → MilestoneAsset
                 │    └── images: [ObjectId] → MilestoneAsset
                 │    └── history (embedded)
                 │
                 └── progressReports (embedded)
                      └── attachments: [ObjectId] → MilestoneAsset

Committee User
  ├── managerPo → PO (User)
  │              └── can only see Tenders created by PO
  │
  └── evaluates → Bids (via committeeEvaluations)

Vendor User
  └── submits → Bids (to Tenders)
```

---

## 2. Authentication Flow

### 2.1 Login Flow

```
┌─────────────────────────────────────────────────┐
│ 1. Frontend: POST /api/auth/login               │
│    Body: { email, password }                    │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│ 2. Backend: authController.login()              │
│    - Find user by email                         │
│    - Compare password with hashed version       │
│    - Generate JWT token                         │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│ 3. Return JWT Token                             │
│    Header: { Authorization: Bearer <token> }   │
│    Body: { user: { id, name, email, role } }   │
└─────────────────────────────────────────────────┘
```

### 2.2 JWT Token Structure

```javascript
JWT Header: {
  "alg": "HS256",
  "typ": "JWT"
}

JWT Payload: {
  "id": "user_id",
  "email": "user@example.com",
  "role": "PO",
  "iat": 1234567890
}

JWT Signature: HMACSHA256(
  base64UrlEncode(header) + "." +
  base64UrlEncode(payload),
  SECRET_KEY
)
```

### 2.3 Protected Route Flow

```
Frontend Request
  ↓
Header: Authorization: Bearer <JWT_TOKEN>
  ↓
Backend: auth middleware
  ├─ Extract token from header
  ├─ Verify JWT signature (using process.env.JWT_SECRET)
  ├─ Check token expiry
  ├─ Extract user info (id, role)
  └─ Attach to req.user
  ↓
Check Role Authorization
  ├─ Is role in required roles? 
  ├─ YES → Proceed to route handler
  └─ NO → Return 403 Forbidden
  ↓
Route Handler executes
```

### 2.4 Authentication Middleware Code
```javascript
// middleware/auth.js
const auth = (roles = []) => {
  return (req, res, next) => {
    try {
      const authHeader = req.header('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'No auth token' });
      }
      
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded; // { id, email, role, iat }
      
      if (roles.length && !roles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      
      next();
    } catch (err) {
      res.status(401).json({ message: 'Token invalid' });
    }
  };
};
```

### 2.5 Role-Based Access Control (RBAC)

| Endpoint | Roles | What Happens |
|----------|-------|--------------|
| `GET /api/tenders` | Any | Committee: Only PO's tenders, Others: All published |
| `POST /api/tenders` | CPO, PO | Create new tender |
| `GET /api/tenders/:id/bids` | Committee, CPO, PO | Committee: Only PO's tenders, Others: Any |
| `POST /api/tenders/:id/bids` | Vendor | Submit bid |
| `PUT /api/tenders/:id/bids/:bidId/evaluate` | Committee | Evaluate bid |
| `GET /api/contracts` | Vendor, CPO, PO, Committee | Vendor: Own contracts, Others: All |

---

## 3. File Storage Architecture

### 3.1 Three-Tier Storage Strategy

```
┌──────────────────────────────────────────────────────────────┐
│ TIER 1: Tender Documents (Small, Metadata-like)             │
├──────────────────────────────────────────────────────────────┤
│ Storage: Tender.documents: [String]                         │
│ Content: Base64 or URLs                                     │
│ Max Size: ~100KB per document (stays in Tender doc)         │
│ Use: Tender specs, requirements, attachments                │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ TIER 2: Bid Documents (Medium, Separated Collection)        │
├──────────────────────────────────────────────────────────────┤
│ Storage: BidDocument collection                             │
│ Content: Base64 or data: URLs                               │
│ Max Size: Can exceed Tender size (separate collection)      │
│ Reference: Bid.proposalDocumentId → BidDocument._id         │
│ Use: Vendor proposal PDFs, quotes, technical docs           │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ TIER 3: Milestone/Report Assets (Large, Separate Coll.)    │
├──────────────────────────────────────────────────────────────┤
│ Storage: MilestoneAsset collection                          │
│ Content: Base64 encoded files                               │
│ Reference: Milestone.documents → [MilestoneAsset._id]       │
│ Use: Progress reports, photos, inspection docs, PDFs        │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 File Upload Flow (Bid Document)

```
1. FRONTEND
   ├─ User selects file (e.g., proposal.pdf)
   ├─ Convert to Base64 or data: URL
   └─ Send: POST /api/tenders/:id/bids
      Body: {
        proposedAmount: 50000,
        proposalDocument: "data:application/pdf;base64,..."
      }

2. BACKEND: submitBid()
   ├─ Decode proposalDocument string
   ├─ Extract: name, content, mimeType
   ├─ Create BidDocument in separate collection
   │  {
   │    tenderId: req.params.id,
   │    vendorId: req.user.id,
   │    name: "proposal.pdf",
   │    content: "base64_encoded_content",
   │    mimeType: "application/pdf"
   │  }
   ├─ Get returned BidDocument._id
   ├─ Save reference in Bid (inside Tender):
   │  {
   │    proposalDocumentId: storedBidDocument._id,
   │    proposalDocument: buildProposalDocumentReference({
   │      name: "proposal.pdf",
   │      contentUrl: "/api/tenders/:tenderId/bid-documents/:docId",
   │      mimeType: "application/pdf"
   │    })
   │  }
   └─ Save Tender

3. RESPONSE
   └─ Return 201: "Bid submitted"
      (Bid now has reference URL, not full content)
```

### 3.3 File Download Flow (Bid Document)

```
1. FRONTEND
   ├─ User clicks "Download Proposal"
   └─ Fetch: GET /api/tenders/:tenderId/bid-documents/:documentId

2. BACKEND: getBidDocument()
   ├─ Find BidDocument by:
   │  - _id: documentId
   │  - tenderId: req.params.id (security check)
   ├─ Check if content is URL:
   │  - YES: res.redirect(content)
   │  - NO: Decode Base64 → Buffer
   ├─ Set response headers:
   │  - Content-Type: application/pdf
   │  - Content-Disposition: inline; filename="proposal.pdf"
   │  - Cache-Control: private, max-age=300
   └─ Send buffer to client

3. BROWSER
   └─ Receives PDF binary data → Downloads/Opens file
```

### 3.4 Milestone Asset Upload Flow

```
1. FRONTEND
   ├─ User uploads progress photo/PDF
   ├─ Convert to Base64
   └─ Send: PUT /api/contracts/:id/milestones/:milestoneId
      Body: {
        documents: ["data:application/pdf;base64,..."],
        images: ["data:image/png;base64,..."]
      }

2. BACKEND: updateMilestone()
   ├─ For each document in documents array:
   │  └─ Call resolveAssetIds({
   │       values: documents,
   │       contractId: req.params.id,
   │       milestoneId: req.params.milestoneId,
   │       uploadedBy: req.user.id,
   │       assetType: 'milestone-document',
   │       fallbackName: 'Milestone document'
   │     })
   │
   ├─ Inside resolveAssetIds():
   │  ├─ Check if value is ObjectId (skip if already stored)
   │  ├─ Decode Base64 content
   │  ├─ Create MilestoneAsset:
   │  │  {
   │  │    contractId,
   │  │    milestoneId,
   │  │    uploadedBy: req.user.id,
   │  │    assetType: 'milestone-document',
   │  │    name: 'report.pdf',
   │  │    content: 'base64_string',
   │  │    mimeType: 'application/pdf'
   │  │  }
   │  └─ Return MilestoneAsset._id
   │
   ├─ Milestone.documents = [returned_ids]
   ├─ Save Contract
   └─ Return updated milestone

3. RESPONSE
   └─ Milestone.documents now contains only IDs
      Example: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012']
```

### 3.5 Milestone Asset Retrieval & Enrichment

```
1. FRONTEND
   ├─ Calls: GET /api/contracts/:id
   └─ Receives contract with milestone.documents = [ObjectIds]

2. BACKEND: getContractById()
   ├─ Fetch contract with embedded milestones
   ├─ Call enrichContractAssetReferences(req, contract)
   │  ├─ Extract all ObjectIds from milestone.documents
   │  ├─ Batch fetch MilestoneAssets by IDs (not full content)
   │  ├─ For each asset:
   │  │  └─ Build access URL: /api/contracts/:contractId/assets/:assetId
   │  └─ Build references: {
   │       name: 'report.pdf',
   │       content: 'http://...access_url...',
   │       mimeType: 'application/pdf'
   │     }
   ├─ Replace IDs with reference objects
   └─ Return enriched contract

3. FRONTEND
   ├─ Receives milestone with usable references
   └─ Can display links to download files
```

### 3.6 File Access Endpoint

```javascript
// GET /api/contracts/:contractId/assets/:assetId
export const getContractAsset = async (req, res) => {
  const asset = await MilestoneAsset.findOne({
    _id: req.params.assetId,
    contractId: req.params.contractId  // Security: Only contract owner
  });
  
  if (!asset) return res.status(404).json(...);
  
  // If content is URL, redirect
  if (asset.content.startsWith('http')) {
    return res.redirect(asset.content);
  }
  
  // Decode Base64 to Buffer
  const buffer = Buffer.from(asset.content, 'base64');
  
  // Set response headers
  res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${asset.name}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  return res.send(buffer);
};
```

### 3.7 MongoDB 16 MB Limit Problem & Solution

```
BEFORE (All in one document):
Contract {
  _id: ...,
  tenderId: ...,
  vendorId: ...,
  milestones: [
    {
      title: "...",
      documents: [
        "data:application/pdf;base64,<large_base64>",  ← Takes space
        "data:image/png;base64,<another_base64>",      ← Takes space
        ...more documents...
      ]
    },
    ...5 more milestones...
  ],
  progressReports: [
    {
      attachments: [
        "data:application/pdf;base64,<large_base64>",  ← Takes space
        ...
      ]
    },
    ...10 more reports...
  ]
}
→ RISK: Document exceeds 16 MB after 50-100 files
```

```
AFTER (Separated collection):
Contract {
  _id: ...,
  milestones: [
    {
      title: "...",
      documents: ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"]  ← Just IDs
    }
  ]
}

MilestoneAsset {
  _id: "507f1f77bcf86cd799439011",
  contractId: contract._id,
  content: "data:application/pdf;base64,<large_base64>"  ← Separate document
}
→ SOLUTION: No size limit per file
```

---

## 4. Data Access Patterns

### 4.1 Committee Member Access Control

```
SCENARIO: Committee member tries to access tender

┌─ Request: GET /api/tenders/:tenderId
├─ Headers: Authorization: Bearer <JWT_Token>
└─ JWT decoded: { id: 'committee123', role: 'Committee', ... }

1. Middleware: auth(['Committee', 'CPO', 'PO'])
   ├─ Verify token signature ✓
   ├─ Check role = 'Committee' ✓
   └─ Attach to req.user ✓

2. Controller: getTenderById()
   ├─ Check if user.role === 'Committee'
   ├─ Fetch user from DB:
   │  const user = await User.findById(req.user.id)
   │                    .select('managerPo')
   ├─ Extract user.managerPo (PO's ID)
   ├─ Fetch tender:
   │  const tender = await Tender.findById(req.params.tenderId)
   │                      .populate('createdBy', 'name')
   ├─ Compare: tender.createdBy === user.managerPo?
   │  ├─ YES: Return tender ✓
   │  └─ NO: Return 403 Forbidden ✗
   └─ Return response

FLOW FOR getTenders:
1. If Committee: GET all tenders where createdBy = user.managerPo
2. If CPO/PO: GET all tenders (no filtering)
3. If Vendor: GET all published tenders
```

### 4.2 Query Optimization

```javascript
// SLOW: Fetches full tender with all bids
const tender = await Tender.findById(id);
// Returns: 1-2 MB for large tender

// FAST: Fetch only necessary fields
const tender = await Tender.findById(id)
  .select('_id title createdBy')
  .lean(); // Returns plain JS object, not Mongoose doc

// INDEXED: Use index for fast filtering
await Tender.find({ createdBy: poId }); // Index on createdBy helps
await BidDocument.find({ tenderId: id }); // Index on tenderId helps
```

### 4.3 Bid Enrichment Pattern

```javascript
// Step 1: Get tender with bids (IDs only)
const tender = await Tender.findById(id);
// tender.bids[0] = {
//   _id: '...',
//   proposalDocumentId: '507f1f77bcf86cd799439011',
//   proposalDocument: "{name, content: 'url', mimeType}",
//   ...
// }

// Step 2: Enrich with document details
const enrichedBids = await enrichBidDocumentReferences(
  req, 
  tender._id, 
  tender.bids
);
// enrichedBids[0].proposalDocument = {
//   name: 'proposal.pdf',
//   content: 'http://localhost:5000/api/tenders/.../bid-documents/...',
//   mimeType: 'application/pdf'
// }

// Step 3: Map with vendor details
const mappedBids = enrichedBids.map(mapBidWithVendorDetails);
// Adds vendorDetails object with name, email, etc.

// Step 4: Return to frontend
return res.json(mappedBids);
```

---

## 5. API Endpoints Overview

### 5.1 Tender Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/api/tenders` | CPO, PO | Create tender |
| GET | `/api/tenders` | Any | List tenders (filtered by role) |
| GET | `/api/tenders/:id` | Any | Get tender details |
| GET | `/api/tenders/:id/documents/:docIndex` | Any | Download tender document |
| PUT | `/api/tenders/:id/publish` | CPO, PO | Publish draft tender |
| PUT | `/api/tenders/:id/close` | CPO, PO | Close tender |
| PUT | `/api/tenders/:id` | CPO, PO | Edit tender |

### 5.2 Bid Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/api/tenders/:id/bids` | Vendor | Submit bid |
| GET | `/api/tenders/:id/bids` | Committee, CPO, PO | List bids |
| GET | `/api/tenders/:id/bid-documents/:docId` | Any | Download bid document |
| PUT | `/api/tenders/:tenderId/bids/:bidId/evaluate` | Committee | Evaluate bid |
| GET | `/api/tenders/:id/evaluated-bids` | CPO, PO, Committee | List evaluated bids |
| PUT | `/api/tenders/:tenderId/bids/:bidId/select` | CPO, PO | Select winner |

### 5.3 Contract Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/contracts` | Any | List contracts |
| GET | `/api/contracts/:id` | Any | Get contract details |
| PUT | `/api/contracts/:id/timeline` | CPO, PO | Define milestones |
| PUT | `/api/contracts/:id/milestones/:mId` | Committee, PO, CPO | Update milestone |
| POST | `/api/contracts/:id/progress-reports` | Committee, PO, CPO, Vendor | Submit progress report |
| GET | `/api/contracts/:id/assets/:assetId` | Any | Download milestone/report asset |
| GET | `/api/contracts/:id/delay-analysis` | Any | Get delay analysis |

---

## 6. Key Concepts Q&A

### Q1: Why are Bid documents stored separately from Tender?

**Answer:**
- MongoDB has 16 MB document size limit
- Tender can have many bids, each with large PDF
- If stored in Tender: Contract grows quickly and hits limit
- Solution: BidDocument collection stores full content, Bid stores only ID reference
- Benefit: Fast tender queries (doesn't fetch 100s MB of bid content)

---

### Q2: How does Committee member access control work?

**Answer:**
1. Committee user has `managerPo` field pointing to their PO
2. When they request tenders:
   - Fetch user's `managerPo` value
   - Only return tenders where `createdBy === managerPo`
3. If they try to access another PO's tender → 403 Forbidden
4. This ensures department-level access control

---

### Q3: What's the difference between embedded and separated collections?

**Answer:**

| Embedded (Inside Tender) | Separated (Own Collection) |
|------------------------|--------------------------|
| Bids, DraftMilestones | BidDocument, MilestoneAsset |
| Part of parent document | Own MongoDB document |
| Atomic updates (all/nothing) | Flexible updates (individual) |
| Query all together | Query separately with ID |
| Size adds to parent limit | No size impact on parent |

**When to use each:**
- **Embedded**: Small, frequently accessed data (milestones list)
- **Separated**: Large content, rarely accessed in full (actual files)

---

### Q4: How is JWT authentication different from session-based?

**Answer:**

| JWT | Session-Based |
|-----|----------------|
| Stateless (server doesn't store) | Stateful (server stores session) |
| Token sent in Authorization header | Cookie-based |
| Signature-based verification | Database lookup on each request |
| Scalable (no server state) | Harder to scale (session storage) |
| Used in: REST APIs, Mobile apps | Used in: Traditional web apps |

**JWT Flow:**
1. User login → Server generates JWT
2. Client stores JWT locally
3. Each request → JWT sent in header
4. Server verifies signature (no DB lookup needed!)

---

### Q5: What happens when a Committee member submits an evaluation?

**Answer:**
```
1. Frontend POST /api/tenders/:tenderId/bids/:bidId/evaluate
   Body: {
     technicalScore: 75,
     financialScore: 80,
     comments: "Good proposal"
   }

2. Backend: evaluateBid()
   ├─ Find tender
   ├─ Find bid within tender.bids
   ├─ Check if Committee member already evaluated this bid
   │  ├─ YES: Update existing evaluation
   │  └─ NO: Add to committeeEvaluations array
   ├─ Recalculate aggregated scores:
   │  technicalScore = avg(all technicalScores)
   │  financialScore = avg(all financialScores)
   ├─ Set bid.status = 'Evaluated'
   └─ Save tender

3. Result:
   ├─ Other committee members can see this evaluation
   ├─ CPO/PO can see aggregated scores
   └─ Bid can be compared against other bids
```

---

### Q6: What's the data flow for milestone progress tracking?

**Answer:**
```
1. PO defines contract timeline
   └─ Creates milestones with planned dates

2. Committee uploads progress
   ├─ Uploads documents/images
   └─ resolveAssetIds() creates MilestoneAsset records
   └─ Milestone.documents = [asset_ids]

3. Committee submits progress report
   ├─ Creates progressReport with attachments
   └─ Progress report attachments also stored as MilestoneAssets

4. System enriches on read
   ├─ Get contract
   ├─ For each milestone.documents ID:
   │  ├─ Fetch MilestoneAsset (metadata only, not content)
   │  ├─ Build access URL
   │  └─ Return reference { name, url, mimeType }
   └─ Return contract with usable URLs

5. Frontend displays
   ├─ Shows links to download assets
   ├─ User clicks → GET /api/contracts/:id/assets/:assetId
   └─ Browser receives file binary data
```

---

### Q7: How does filtering work for different user roles?

**Answer:**

| Role | GET /api/tenders | GET /api/tenders/:id/bids | GET /api/contracts |
|------|------------------|--------------------------|-------------------|
| **CPO** | All tenders | All tenders' bids | All contracts |
| **PO** | Only own tenders | Only own tenders' bids | Only own awarded contracts |
| **Committee** | Only assigned PO's tenders | Only assigned PO's tenders' bids | All contracts (any PO) |
| **Vendor** | Published tenders only | Only their own bids | Only their own contracts |

**Implementation:**
```javascript
// getTenders example
if (req.user.role === 'Committee') {
  const user = await User.findById(req.user.id).select('managerPo');
  filter = { createdBy: user.managerPo };
} else if (req.user.role === 'PO') {
  filter = { createdBy: req.user.id };
}
// CPO: no filter (all tenders)
// Vendor: filtered at frontend
```

---

### Q8: Why use stringified JSON for proposalDocument field?

**Answer:**

Instead of:
```javascript
proposalDocument: {
  name: "proposal.pdf",
  contentUrl: "http://...",
  mimeType: "application/pdf"
}
```

We use:
```javascript
proposalDocument: '{"name":"proposal.pdf","contentUrl":"http://...","mimeType":"application/pdf"}'
```

**Reasons:**
1. **Consistency**: Can store legacy values (URLs, base64) as strings
2. **Flexibility**: Can be string, URL, or reference without schema change
3. **Backwards compatibility**: Old code expects string values
4. **Easy parsing**: JSON.parse() when needed
5. **Storage**: Strings use slightly less metadata than objects

---

### Q9: What security headers are set when downloading files?

**Answer:**
```javascript
res.setHeader('Content-Type', decoded.mimeType);
// Tells browser what type of file (pdf, image, etc)

res.setHeader('Content-Disposition', `inline; filename="file.pdf"`);
// 'inline' = open in browser, 'attachment' = force download

res.setHeader('Cache-Control', 'private, max-age=300');
// 'private' = browser cache only, max-age=300 = cache for 5 mins

res.setHeader('X-Content-Type-Options', 'nosniff');
// Prevents MIME-sniffing attacks (must serve as declared type)
```

---

### Q10: How are scores aggregated when multiple committee members evaluate?

**Answer:**
```javascript
// Each committee member provides evaluation:
bid.committeeEvaluations = [
  { 
    committeeMemberId: 'member1',
    technicalScore: 80,
    financialScore: 75
  },
  { 
    committeeMemberId: 'member2',
    technicalScore: 85,
    financialScore: 78
  }
]

// Aggregation in updateMilestone():
const evaluationCount = bid.committeeEvaluations.length;

const technicalTotal = bid.committeeEvaluations.reduce(
  (sum, e) => sum + (e.technicalScore || 0),
  0
);

bid.technicalScore = technicalTotal / evaluationCount;
// = (80 + 85) / 2 = 82.5

bid.financialScore = (75 + 78) / 2 = 76.5;

// CPO/PO sees aggregated scores, not individual evaluations
```

---

## Summary Flowchart

```
┌─────────────────┐
│ USER LOGIN      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Generate JWT Token              │
│ Payload: { id, role, email }    │
└────────┬────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ Send Token in Authorization Header   │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ Request Protected API Endpoint       │
│ Middleware verifies JWT signature    │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ Check Role-Based Access Control      │
│ Filter data based on user role       │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ Database Query with Filters          │
│ Enriched with references/URLs        │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ Return Filtered, Enriched Response   │
│ Frontend displays to user            │
└──────────────────────────────────────┘
```

---

## Quick Reference: Important Files

| File | Purpose |
|------|---------|
| `/backend/models/model.js` | Database schemas |
| `/backend/middleware/auth.js` | JWT authentication |
| `/backend/controllers/tenderController.js` | Tender/bid logic, file storage |
| `/backend/controllers/contractController.js` | Contract/milestone/asset logic |
| `/backend/routes/tenderRoutes.js` | Tender API endpoints |
| `/backend/routes/contractRoutes.js` | Contract API endpoints |
| `/backend/scripts/seed.js` | Sample data generation |

---

## Study Tips

1. **Start with schemas**: Understand the data structure first
2. **Trace a flow**: Follow a single action (e.g., "Submit bid") through entire stack
3. **Focus on access control**: Committee → PO filtering is key concept
4. **File storage**: Understand why it's split into 3 tiers
5. **Practice explaining**: Try explaining each concept without looking
6. **Draw diagrams**: Visualize relationships and flows
7. **Read code**: Look at actual implementation after understanding concepts

Good luck with your study! 🚀
