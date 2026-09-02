import { config } from 'dotenv';
import path from 'path';

// Load DATABASE_URL from packages/database/.env
config({ path: path.resolve(__dirname, '../../packages/database/.env') });