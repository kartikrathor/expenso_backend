import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db';
import authRoutes from './routes/auth';
import groupRoutes from './routes/groups';
import groupExpenseRoutes from './routes/groupExpenses';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'expenso-server' });
});

app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/groups/:groupId/expenses', groupExpenseRoutes);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes('YOUR_DB_PASSWORD_HERE')) {
    console.error('❌ Set a real MONGODB_URI in server/.env (replace YOUR_DB_PASSWORD_HERE)');
    process.exit(1);
  }

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change_this_to_a_long_random_string') {
    console.warn('⚠️  Set a strong JWT_SECRET in server/.env before production');
  }

  await connectDB(uri);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Expenso API running on http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
