import app from './src/app.js';
import connectDatabase from './src/config/database.js';

await connectDatabase();

export default app;
