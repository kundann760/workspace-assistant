// Vercel serverless entry point: the whole Express API runs as one function.
// vercel.json rewrites every /api/* request here; Express routes on the original path.
// Locally you don't use this file: `npm run dev` starts the API with server/src/index.ts.
const { createApp } = require('../server/dist/app.js');

module.exports = createApp();
