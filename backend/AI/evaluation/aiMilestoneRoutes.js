import express from 'express';
import auth from '../../middleware/auth.js';
import { getMilestoneReports, getNotifications, markNotificationRead } from './aiMilestoneController.js';

const router = express.Router();

router.get('/contracts/:contractId', auth(['PO', 'CPO', 'Committee']), getMilestoneReports);
router.get('/notifications', auth(['PO', 'CPO']), getNotifications);
router.put('/notifications/:notificationId/read', auth(['PO', 'CPO']), markNotificationRead);

export default router;
