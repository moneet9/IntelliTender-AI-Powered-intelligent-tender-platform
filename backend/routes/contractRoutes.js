import express from 'express';
const router = express.Router();
import auth from '../middleware/auth.js';
import { getContracts, getContractById, updateContractStatus } from '../controllers/contractController.js';

router.get('/', auth(['CPO', 'PO', 'Committee']), getContracts);
router.get('/:id', auth(['CPO', 'PO', 'Committee', 'Vendor']), getContractById);
router.put('/:id/status', auth(['CPO', 'PO']), updateContractStatus);

export default router;
