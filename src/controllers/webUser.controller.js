// The website's own sign-ups (web_users) and reviews (web_reviews).
//
// These two tables belong to the website, not to this backend: it created
// them, it writes them, and its schema can change without us. So they are read
// with raw SQL and left out of schema.prisma — a Prisma model here would claim
// ownership of a table this service does not own, and the next `migrate diff`
// would offer to "fix" the website's columns.
//
// Read-only, and admin-only: these rows carry people's email addresses and
// phone numbers.
const prisma = require('../db');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function readPaging(query) {
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1) return { error: 'limit must be a positive integer' };
    limit = Math.min(limit, MAX_LIMIT);
  }

  let offset = 0;
  if (query.offset !== undefined) {
    offset = Number(query.offset);
    if (!Number.isInteger(offset) || offset < 0) return { error: 'offset must be zero or more' };
  }

  return { limit, offset };
}

// GET /api/admin/web-users?search=&subscribed=true|false&limit=&offset=
async function listWebUsers(req, res) {
  try {
    const paging = readPaging(req.query);
    if (paging.error) return res.status(400).json({ error: { message: paging.error } });

    const search = (req.query.search ?? '').trim();
    const like = `%${search}%`;

    let subscribed = null;
    if (req.query.subscribed !== undefined && req.query.subscribed !== '') {
      if (!['true', 'false'].includes(req.query.subscribed)) {
        return res.status(400).json({ error: { message: 'subscribed must be true or false' } });
      }
      subscribed = req.query.subscribed === 'true';
    }

    // Values are passed as parameters, never interpolated: these strings come
    // from a query string.
    const [rows, totals] = await Promise.all([
      prisma.$queryRaw`
        SELECT id, email, name, phone,
               data->>'picture' AS picture,
               "createdAt", is_subscribed
        FROM web_users
        WHERE (${search} = '' OR email ILIKE ${like}
                             OR COALESCE(name, '') ILIKE ${like}
                             OR COALESCE(phone, '') ILIKE ${like})
          AND (${subscribed}::boolean IS NULL OR is_subscribed = ${subscribed}::boolean)
        -- Some rows have no createdAt, and they must not lead the list.
        ORDER BY "createdAt" DESC NULLS LAST, id DESC
        LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      prisma.$queryRaw`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE is_subscribed)::int AS subscribed
        FROM web_users
        WHERE (${search} = '' OR email ILIKE ${like}
                             OR COALESCE(name, '') ILIKE ${like}
                             OR COALESCE(phone, '') ILIKE ${like})
          AND (${subscribed}::boolean IS NULL OR is_subscribed = ${subscribed}::boolean)`,
    ]);

    return res.status(200).json({
      webUsers: rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        phone: r.phone,
        picture: r.picture,
        isSubscribed: r.is_subscribed,
        createdAt: r.createdAt,
      })),
      total: totals[0].total,
      subscribedCount: totals[0].subscribed,
      limit: paging.limit,
      offset: paging.offset,
    });
  } catch (error) {
    console.error('listWebUsers error:', error);
    return res.status(500).json({ error: { message: 'Failed to load website users' } });
  }
}

// GET /api/admin/web-users/:id
async function getWebUser(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: { message: 'Invalid id' } });

    const rows = await prisma.$queryRaw`
      SELECT id, email, name, phone, data, "createdAt", is_subscribed
      FROM web_users WHERE id = ${id}`;
    if (rows.length === 0) return res.status(404).json({ error: { message: 'Website user not found' } });

    const r = rows[0];
    // Whether the same person also uses the app. The two are separate
    // accounts; the email is what ties them together.
    const appUser = await prisma.user.findFirst({
      where: { email: r.email },
      select: { id: true, name: true, status: true, createdAt: true, selectedCourseId: true },
    });

    return res.status(200).json({
      webUser: {
        id: r.id,
        email: r.email,
        name: r.name,
        phone: r.phone,
        picture: r.data?.picture ?? null,
        signedInWithGoogle: Boolean(r.data?.googleId),
        isSubscribed: r.is_subscribed,
        createdAt: r.createdAt,
      },
      appUser,
    });
  } catch (error) {
    console.error('getWebUser error:', error);
    return res.status(500).json({ error: { message: 'Failed to load the website user' } });
  }
}

// GET /api/admin/web-reviews?status=&limit=&offset=
//
// The site's reviews. Same ownership caveat as above.
async function listWebReviews(req, res) {
  try {
    const paging = readPaging(req.query);
    if (paging.error) return res.status(400).json({ error: { message: paging.error } });

    const status = (req.query.status ?? '').trim();

    const [rows, totals] = await Promise.all([
      prisma.$queryRaw`
        SELECT id, status, created_at,
               data->>'name' AS name,
               data->>'body' AS body,
               (data->>'rating')::numeric AS rating
        FROM web_reviews
        WHERE (${status} = '' OR status = ${status})
        ORDER BY created_at DESC
        LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      prisma.$queryRaw`
        SELECT COUNT(*)::int AS total FROM web_reviews
        WHERE (${status} = '' OR status = ${status})`,
    ]);

    return res.status(200).json({
      webReviews: rows.map((r) => ({
        id: r.id,
        name: r.name,
        body: r.body,
        // numeric comes back as a string from pg; the panel wants a number.
        rating: r.rating === null ? null : Number(r.rating),
        status: r.status,
        createdAt: r.created_at,
      })),
      total: totals[0].total,
      limit: paging.limit,
      offset: paging.offset,
    });
  } catch (error) {
    console.error('listWebReviews error:', error);
    return res.status(500).json({ error: { message: 'Failed to load website reviews' } });
  }
}

module.exports = { listWebUsers, getWebUser, listWebReviews };
