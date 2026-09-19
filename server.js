import app from './src/app.js';
import connectDatabase from './src/config/database.js';

console.log('🔥 FITLYPRO ROOT SERVER.JS LOADED');
console.log('🔥 APP_DB_URL PRESENT:', Boolean(process.env.APP_DB_URL));
console.log('🔥 BEFORE DB CONNECT');

await connectDatabase();

console.log('🔥 AFTER DB CONNECT');

export default app;
