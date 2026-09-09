// One Prisma client for the whole process.
//
// Every controller used to build its own, which meant 19 independent
// connection pools to the same database. Each pool warms up separately, so a
// request landing on a cold one pays the full connection setup — measured at
// 1.4 to 3.4 seconds against Neon — and Postgres sees 19x the idle
// connections it needs.
//
// A pool is per-process, so sharing one is not a micro-optimisation: it is the
// difference between a connection that is already open and one that has to be
// negotiated across a continent while a student waits.
const { PrismaClient } = require('./generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Reused across hot reloads in development, where re-requiring this file would
// otherwise leak a pool per reload until Postgres refuses new connections.
// Reads that pull relations go out as ONE query with LATERAL JOINs instead of
// one query per relation.
//
// Prisma's default issues a separate round trip per nested select. The
// question bank pulls four — subject, topic, options, tags — so a page of 20
// cost 739ms against a database ~200ms away. With joins it is 295ms: one trip
// instead of three.
//
// Applied here as an extension rather than per call site, because the win is
// worth nothing if the next query someone writes forgets it. Only read
// operations take the option; writes reject it.
const READ_OPS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow']);

const base = globalThis.__prismaBase ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== 'production') globalThis.__prismaBase = base;

const prisma = globalThis.__prisma ?? base.$extends({
  query: {
    $allModels: {
      $allOperations({ operation, args, query }) {
        // Never override an explicit choice — a caller that asked for 'query'
        // usually did so because a join blew up on a large fan-out.
        if (READ_OPS.has(operation) && args.relationLoadStrategy === undefined) {
          return query({ ...args, relationLoadStrategy: 'join' });
        }
        return query(args);
      },
    },
  },
});
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

module.exports = prisma;
