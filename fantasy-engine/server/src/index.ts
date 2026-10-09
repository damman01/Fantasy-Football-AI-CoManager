import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import authRoutes from './routes/auth';
import espnRoutes from './routes/espn';
import testRoutes from './routes/test';
import dashboardRoutes from './routes/dashboard';
import mcpRoutes from './routes/mcp';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3003'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'X-ESPN-S2', 'X-ESPN-SWID'],
  exposedHeaders: ['X-ESPN-S2', 'X-ESPN-SWID']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/vendor/lucide', express.static(path.join(__dirname, '../node_modules/lucide/dist/umd')));

app.use('/api/auth', authRoutes);
app.use('/api/espn', espnRoutes);
app.use('/api/test', testRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/mcp', mcpRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});