require('dotenv').config();
const jwt = require('jsonwebtoken');
const prisma = require('./src/db');

(async () => {
  const USER = 51;
  const u = await prisma.user.findUnique({
    where: { id: USER },
    select: { id: true, selectedCourseId: true, selectedCourseTypeId: true,
              selectedCourse: { select: { id: true, accessType: true } } },
  });
  const subs = await prisma.subscription.findMany({
    where: { userId: USER, isActive: true, endDate: { gte: new Date() } },
    select: { planId: true },
  });
  console.log(`user ${USER} · course ${u.selectedCourseId} is ${u.selectedCourse.accessType} · exam ${u.selectedCourseTypeId} · active subs: ${subs.length}`);

  const s = await prisma.session.findFirst({ where: { userId: USER }, select: { id: true } });
  const sessionId = s ? s.id : null;
  if (!sessionId) { console.log('no session row for this user — cannot mint a usable token'); process.exit(1); }
  const token = jwt.sign({ userId: USER, sessionId }, process.env.JWT_ACCESS_SECRET, { expiresIn: '10m' });

  const get = async (path) => {
    const r = await fetch(`http://localhost:3000${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return [r.status, await r.json()];
  };

  for (const id of [53, 55]) {
    const l = await prisma.lesson.findUnique({ where: { id }, select: { type: true, accessType: true } });
    const [code, body] = await get(`/api/users/me/lessons/${id}`);
    const lesson = body.lesson ?? body;
    console.log(`\nlesson ${id} ${l.type} accessType=${l.accessType} → HTTP ${code}`);
    console.log(`  locked: ${lesson.locked ?? '(n/a)'} | videoUrl: ${JSON.stringify(lesson.videoUrl ?? null)}`);
    if (body.error) console.log(`  error: ${body.error.message}`);
  }
  await prisma.$disconnect();
})();
