import express from 'express';
import auth from '../../middleware/auth.js';
import { runTenderAiScoring, getTenderAiSummaries, getBidAiSummary, getTenderAiEvaluationState } from './aiScoringController.js';

const router = express.Router();

router.post('/tenders/:tenderId/run', auth(['PO', 'CPO']), runTenderAiScoring);
router.get('/tenders/:tenderId/state', auth(['PO', 'CPO', 'Committee']), getTenderAiEvaluationState);
router.get('/tenders/:tenderId', auth(['PO', 'CPO', 'Committee']), getTenderAiSummaries);
router.get('/tenders/:tenderId/bids/:bidId', auth(['PO', 'CPO', 'Committee']), getBidAiSummary);

export default router;
