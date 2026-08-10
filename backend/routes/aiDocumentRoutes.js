import express from 'express';
import auth from '../middleware/auth.js';
import {
  isLocalAiOnline,
  rebuildDocumentEmbeddingsByScope,
} from '../AI/documents/documentEmbeddingService.js';

const router = express.Router();

router.get('/status', auth(['PO', 'CPO']), async (req, res) => {
  try {
    const online = await isLocalAiOnline();
    res.json({ online });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to check AI status' });
  }
});

router.post('/rebuild', auth(['PO', 'CPO']), async (req, res) => {
  try {
    const scope = String(req.body?.scope || 'all').toLowerCase();
    const result = await rebuildDocumentEmbeddingsByScope(scope);
    res.json({
      message: 'Document embeddings rebuilt',
      scope,
      result,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to rebuild document embeddings' });
  }
});

export default router;
