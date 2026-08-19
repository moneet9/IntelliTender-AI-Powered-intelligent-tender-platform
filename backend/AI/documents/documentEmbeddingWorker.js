import { seedDocumentEmbeddingJobs, processPendingDocumentEmbeddingJobs } from './documentEmbeddingService.js';
import { runAutoAiScoring } from '../evaluation/aiScoringController.js';

const EMBEDDING_WORKER_INTERVAL_MS = Number(process.env.DOCUMENT_EMBED_WORKER_INTERVAL_MS || 120000);
const WORKER_READY_DELAY_MS = Number(process.env.DOCUMENT_EMBED_WORKER_START_DELAY_MS || 3000);

let workerStarted = false;
let workerTimer = null;
let workerRunning = false;

async function runCycle() {
    if (workerRunning) return;
    workerRunning = true;

    try {
        await seedDocumentEmbeddingJobs();
        const result = await processPendingDocumentEmbeddingJobs();
        if (result.online && process.env.AI_AUTO_RUN_ENABLED === 'true') {
            await runAutoAiScoring().catch((error) => {
                console.error('AI auto-scoring failed after document prep:', error.message || error);
            });
        }
    } catch (error) {
        console.error('Document prep worker failed:', error.message || error);
    } finally {
        workerRunning = false;
    }
}

export function startDocumentEmbeddingWorker() {
    if (workerStarted) return;
    workerStarted = true;

    setTimeout(() => {
        runCycle()
            .catch((error) => {
                console.error('Document prep seed failed:', error.message || error);
            });
    }, WORKER_READY_DELAY_MS);

    if (EMBEDDING_WORKER_INTERVAL_MS > 0) {
        workerTimer = setInterval(() => {
            void runCycle();
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
