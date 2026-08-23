// Vercel's filesystem-based routing convention: any file under /api at
// the repo root becomes a serverless function automatically, no `builds`
// config needed. This is the entry point Vercel actually looks for — the
// previous vercel.json pointed a `builds` step directly at server/index.js
// instead, which is the likely reason requests kept 404ing regardless of
// the rewrite rules around it.
//
// All real route logic lives in server/index.js (Express app, unchanged);
// this file just hands that app to Vercel as the request handler.
module.exports = require('../server/index.js');