import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import tenderRoutes from './routes/tenderRoutes.js';
import contractRoutes from './routes/contractRoutes.js';
import mockRoutes from './routes/mockRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import aiDocumentRoutes from './routes/aiDocumentRoutes.js';
import chatbotRoutes from './AI/chatbot/chatbotRoutes.js';
import aiScoringRoutes from './AI/evaluation/aiScoringRoutes.js';
import aiMilestoneRoutes from './AI/evaluation/aiMilestoneRoutes.js';
import { runAutoAiScoring } from './AI/evaluation/aiScoringController.js';
import { startDocumentEmbeddingWorker } from './AI/documents/documentEmbeddingWorker.js';

dotenv.config();

// Connect Database
connectDB();

const app = express();

// Init Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/', (req, res) => res.send('API Running'));

// Define Routes
app.use('/api/auth', authRoutes);
app.use('/api/tenders', tenderRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ai/documents', aiDocumentRoutes);
app.use('/api/mock', mockRoutes);
app.use('/api/ai', chatbotRoutes);
app.use('/api/ai/evaluations', aiScoringRoutes);
app.use('/api/ai/milestones', aiMilestoneRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
startDocumentEmbeddingWorker();

const autoScoringEnabled = process.env.AI_AUTO_RUN_ENABLED === 'true';
const autoRunInterval = Number(process.env.AI_AUTO_RUN_INTERVAL_MS || 120000);
if (autoScoringEnabled && autoRunInterval > 0) {
	void runAutoAiScoring().catch((error) => {
		console.error('AI auto-scoring initial run failed:', error.message || error);
	});

	setInterval(() => {
		void runAutoAiScoring().catch((error) => {
			console.error('AI auto-scoring failed:', error.message || error);
		});
	}, autoRunInterval);
}
