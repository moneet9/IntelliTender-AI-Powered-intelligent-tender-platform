import express from 'express';
import auth from '../middleware/auth.js';
import {
  isLocalAiOnline,
  getTenderDocumentEmbeddingProgress,
  getDocumentProcessingDashboard,
  restartDocumentEmbeddingJobs,
  seedDocumentEmbeddingJobs,
  rebuildDocumentEmbeddingsByScope,
  reparseDocumentTextByScope,
} from '../AI/documents/documentEmbeddingService.js';
import { checkLocalAiConnection } from '../AI/localModelClient.js';

const router = express.Router();

router.get('/status', auth(['PO', 'CPO']), async (req, res) => {
  try {
    const connection = await checkLocalAiConnection({ timeoutMs: 5000 });
    // Keep the worker's health cache in sync with the UI probe.
    await isLocalAiOnline();
    res.json(connection);
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

router.get('/dashboard', auth(['PO', 'CPO']), async (req, res) => {
  try {
    // Keep the inventory complete for newly uploaded files; the worker does
    // the expensive OCR/chunk/embedding work asynchronously.
    void seedDocumentEmbeddingJobs().catch((error) => {
      console.error('AI dashboard document seed failed:', error.message || error);
    });
    const documents = await getDocumentProcessingDashboard({ createdBy: req.user?.id });
    res.json(documents);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load document dashboard' });
  }
});

router.post('/restart', auth(['PO', 'CPO']), async (req, res) => {
  try {
    const result = await restartDocumentEmbeddingJobs({
      createdBy: req.user?.id,
      sourceKey: String(req.body?.sourceKey || ''),
      scope: String(req.body?.scope || 'all').toLowerCase(),
      stage: String(req.body?.stage || 'all').toLowerCase(),
    });
    res.json({ message: 'Document processing restart queued', ...result });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to restart document processing' });
  }
});

export default router;
