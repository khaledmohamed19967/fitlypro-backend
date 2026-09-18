/**
 * Vercel Express entry point.
 *
 * Vercel's Express framework preset resolves root `server.js` before
 * `src/server.js` / `src/app.js`. This file re-exports the real FitlyPro
 * Express app so production uses /api/v1/* instead of the legacy toy app.
 *
 * Local development is unchanged: `pnpm dev` / `npm start` still run
 * `src/server.js` (see package.json), which calls app.listen().
 */
import app from './src/app.js';
import connectDatabase from './src/config/database.js';

connectDatabase();

export default app;
