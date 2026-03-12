import express from 'express';
const router = express.Router();
import auth from '../middleware/auth.js';
import {
	getContracts,
	getContractById,
	updateContractStatus,
	defineContractTimeline,
	updateMilestone,
	submitProgressReport,
	getContractDelayAnalysis,
} from '../controllers/contractController.js';

router.get('/', auth(['CPO', 'PO', 'Committee', 'Vendor']), getContracts);
router.get('/:id', auth(['CPO', 'PO', 'Committee', 'Vendor']), getContractById);
router.put('/:id/status', auth(['CPO', 'PO']), updateContractStatus);
router.put('/:id/timeline', auth(['CPO', 'PO']), defineContractTimeline);
router.put('/:id/milestones/:milestoneId', auth(['Committee', 'PO', 'CPO']), updateMilestone);
router.post('/:id/progress-reports', auth(['Committee', 'PO', 'CPO', 'Vendor']), submitProgressReport);
router.get('/:id/delay-analysis', auth(['CPO', 'PO', 'Committee', 'Vendor']), getContractDelayAnalysis);

export default router;
