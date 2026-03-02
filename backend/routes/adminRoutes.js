import express from 'express';
import auth from '../middleware/auth.js';
import {
  createPO,
  listPOs,
  deletePO,
  createCommitteeMember,
  listCommitteeMembers,
  deleteCommitteeMember,
  listVendors,
  freezeVendor,
  deleteVendor,
  getCpoAnalytics,
} from '../controllers/adminController.js';

const router = express.Router();

router.post('/po', auth('CPO'), createPO);
router.get('/po', auth('CPO'), listPOs);
router.delete('/po/:id', auth('CPO'), deletePO);

router.post('/committee', auth('PO'), createCommitteeMember);
router.get('/committee', auth('PO'), listCommitteeMembers);
router.delete('/committee/:id', auth('PO'), deleteCommitteeMember);

router.get('/vendors', auth(['PO', 'CPO']), listVendors);
router.put('/vendors/:id/freeze', auth(['PO', 'CPO']), freezeVendor);
router.delete('/vendors/:id', auth(['PO', 'CPO']), deleteVendor);

router.get('/analytics/cpo', auth('CPO'), getCpoAnalytics);

export default router;
