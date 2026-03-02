import express from 'express';
const router = express.Router();
import {
   getAnalytics, getNotifications, getAuditLogs, getDocuments, getVendorPerformance
} from '../controllers/mockController.js';

router.get('/analytics', getAnalytics);
router.get('/notifications', getNotifications);
router.get('/audit-logs', getAuditLogs);
router.get('/documents', getDocuments);
router.get('/vendors/performance', getVendorPerformance);

export default router;