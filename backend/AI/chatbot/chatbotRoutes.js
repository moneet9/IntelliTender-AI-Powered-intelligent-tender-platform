import express from 'express';
import auth from '../../middleware/auth.js';
import { chatWithAssistant, createChatSession, deleteChatSession, getChatSession, listChatSessions } from './chatbotController.js';

const router = express.Router();

router.get('/chats', auth(['CPO', 'PO', 'Committee', 'Vendor']), listChatSessions);
router.post('/chats', auth(['CPO', 'PO', 'Committee', 'Vendor']), createChatSession);
router.get('/chats/:chatId', auth(['CPO', 'PO', 'Committee', 'Vendor']), getChatSession);
router.delete('/chats/:chatId', auth(['CPO', 'PO', 'Committee', 'Vendor']), deleteChatSession);
router.post('/chat', auth(['CPO', 'PO', 'Committee', 'Vendor']), chatWithAssistant);

export default router;
