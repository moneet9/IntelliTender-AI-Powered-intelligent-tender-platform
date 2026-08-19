import express from 'express';
import auth from '../middleware/auth.js';
import {
  isLocalAiOnline,
  getTenderDocumentEmbeddingProgress,
  rebuildDocumentEmbeddingsByScope,
  reparseDocumentTextByScope,
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
      message: 'Document prep refreshed',
      scope,
      result,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to refresh document prep' });
  }
});

router.post('/reparse', auth(['PO', 'CPO']), async (req, res) => {
    try {
    const scope = String(req.body?.scope || 'all').toLowerCase();
    const result = await reparseDocumentTextByScope(scope);
    res.json({
      message: 'Document text refreshed',
      scope,
      result,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to reparse document text' });
  }
});

router.get('/progress', auth(['PO', 'CPO']), async (req, res) => {
  try {
    const progress = await getTenderDocumentEmbeddingProgress({ createdBy: req.user?.id });
    res.json(progress);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load document prep progress' });
  }
});

export default router;
