
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('exit', (code) => {
  console.log('Process exiting with code:', code);
});

const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const healthRoutes = require('./routes/health.routes');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth.routes');
const courseRoutes = require('./routes/course.routes');
const subjectRoutes = require('./routes/subject.routes');
const selectionRoutes = require('./routes/selection.routes');
const chapterRoutes = require('./routes/chapter.route');
const lessonRoutes = require('./routes/lesson.route');
const profileRoutes = require('./routes/profile.routes');
const uploadRoutes = require('./routes/upload.routes');
const adminRoutes = require('./routes/admin.routes');
const planRoutes = require('./routes/plan.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const subscribeRoutes = require('./routes/subscribe.routes');
const path = require('path');



const app = express();


app.use(cors());
app.use(express.json());

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/users/me/selection', selectionRoutes);

app.use('/api/course-types/:courseTypeId/chapters', chapterRoutes);
app.use('/api/chapters/:chapterId/lessons', lessonRoutes);
app.use('/api', lessonRoutes);
app.use('/api/users/me', profileRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/admin', adminRoutes);
app.use('/api', planRoutes);
app.use('/api/users/me/subscription-status', subscriptionRoutes);
app.use('/api/users/me/subscribe', subscribeRoutes);
app.use('/api/uploads', require('./routes/upload.routes'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));




app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
