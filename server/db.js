require('dotenv').config();
const { PrismaClient } = require('./generated/prisma');
const { PrismaNeon } = require('@prisma/adapter-neon');

// Runtime queries go through the pooled Neon connection (DATABASE_URL).
// The CLI (migrate/studio/seed) uses the direct connection instead — see prisma.config.ts.
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });

const prisma = global.__prisma || new PrismaClient({ adapter });
if (process.env.NODE_ENV !== 'production') global.__prisma = prisma;

module.exports = prisma;
