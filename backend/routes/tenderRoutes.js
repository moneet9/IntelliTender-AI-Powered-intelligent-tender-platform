import express from 'express';
const router = express.Router();
import auth from '../middleware/auth.js';
import {
    createTender, getTenders, getTenderById, getTenderDocument, getBidDocument, editTender, publishTender, closeTender,
    submitBid, withdrawBid, getBidsByTender, evaluateBid, getEvaluatedBids, selectWinner
} from '../controllers/tenderController.js';

// Tender Management (CPO / PO)
router.post('/', auth(['CPO', 'PO']), createTender);
router.get('/', auth(['Vendor', 'CPO', 'PO', 'Committee']), getTenders);
router.get('/:id/documents/:docIndex', auth(['Vendor', 'CPO', 'PO', 'Committee']), getTenderDocument);
router.get('/:id/bid-documents/:documentId', auth(['Vendor', 'CPO', 'PO', 'Committee']), getBidDocument);
router.get('/:id', getTenderById);
router.put('/:id', auth(['CPO', 'PO']), editTender);
router.put('/:id/publish', auth(['CPO', 'PO']), publishTender);
router.put('/:id/close', auth(['CPO', 'PO']), closeTender);

// Bid Submission (Vendor)
router.post('/:id/bids', auth('Vendor'), submitBid);
router.delete('/:id/bids/:bidId', auth('Vendor'), withdrawBid);
router.get('/:id/bids', auth(['Committee', 'CPO', 'PO']), getBidsByTender);

// Evaluation (Committee)
router.put('/:tenderId/bids/:bidId/evaluate', auth('Committee'), evaluateBid);

// Comparison & Winner (CPO / PO)
router.get('/:id/evaluated-bids', auth(['CPO', 'PO', 'Committee']), getEvaluatedBids);
router.put('/:tenderId/bids/:bidId/select', auth(['CPO', 'PO']), selectWinner);

export default router;
