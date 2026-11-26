import app from './src/app.js';
import connectDatabase from './src/config/database.js';

await connectDatabase();

// Vercel Function settings (PDF export needs a longer window than the default).
export const config = {
    maxDuration: 60,
};

export default app;
