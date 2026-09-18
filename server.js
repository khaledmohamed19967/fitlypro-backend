import app from './src/app.js';
import connectDatabase from './src/config/database.js';

console.log('🔥 FITLYPRO SERVER.JS LOADED');

console.log('🔥 Before connectDatabase');
await connectDatabase();
console.log('🔥 After connectDatabase');

export default app;
