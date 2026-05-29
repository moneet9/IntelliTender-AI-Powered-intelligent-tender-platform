import express from 'express';
import auth from '../../middleware/auth.js';
import { chatWithAssistant } from './chatbotController.js';

const router = express.Router();

router.post('/chat', auth(['CPO', 'PO', 'Committee', 'Vendor']), chatWithAssistant);

export default router;