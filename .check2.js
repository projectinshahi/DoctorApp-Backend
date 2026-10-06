require('dotenv').config();
const prisma = require('./src/db');
(async () => {
  const courses = await prisma.course.findMany({ select: { id: true, title: true, accessType: true, status: true } });
  console.log('courses:', courses.map(c => `${c.id} ${c.accessType}/${c.status}`).join(' | '));
  const freeCourses = courses.filter(c => c.accessType === 'free').map(c => c.id);
  console.log('free courses:', freeCourses);
  // students sitting on a free course
  const us = await prisma.user.findMany({
    where: { selectedCourseId: { in: freeCourses } },
    select: { id: true, selectedCourseId: true, selectedCourseTypeId: true,
              subscriptions: { where: { isActive: true, endDate: { gte: new Date() } }, select: { id: true } } },
    take: 5,
  });
  console.log('students on a free course:', us.map(u => `u${u.id} course${u.selectedCourseId} exam${u.selectedCourseTypeId} subs${u.subscriptions.length}`).join(' | ') || '(none)');
  await prisma.$disconnect();
})();
