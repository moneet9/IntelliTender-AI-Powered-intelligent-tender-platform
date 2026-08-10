import { seedDocumentEmbeddingJobs, processPendingDocumentEmbeddingJobs } from './documentEmbeddingService.js';
import { runAutoAiScoring } from '../evaluation/aiScoringController.js';

const EMBEDDING_WORKER_INTERVAL_MS = Number(process.env.DOCUMENT_EMBED_WORKER_INTERVAL_MS || 300000);
const WORKER_READY_DELAY_MS = Number(process.env.DOCUMENT_EMBED_WORKER_START_DELAY_MS || 3000);

let workerStarted = false;
let workerTimer = null;

async function runCycle() {
    try {
        const result = await processPendingDocumentEmbeddingJobs();
        if (result.online) {
            await runAutoAiScoring().catch((error) => {
                console.error('AI auto-scoring failed after document embedding:', error.message || error);
            });
        }
    } catch (error) {
        console.error('Document embedding worker failed:', error.message || error);
    }
}

export function startDocumentEmbeddingWorker() {
    if (workerStarted) return;
    workerStarted = true;

    setTimeout(() => {
        seedDocumentEmbeddingJobs()
            .then(() => runCycle())
            .catch((error) => {
                console.error('Document embedding seed failed:', error.message || error);
            });
    }, WORKER_READY_DELAY_MS);

    if (EMBEDDING_WORKER_INTERVAL_MS > 0) {
        workerTimer = setInterval(() => {
            runCycle();
        }, EMBEDDING_WORKER_INTERVAL_MS);
    }
}

export async function runDocumentEmbeddingNow() {
    await seedDocumentEmbeddingJobs();
    return processPendingDocumentEmbeddingJobs();
}

export function stopDocumentEmbeddingWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
    workerStarted = false;
}
