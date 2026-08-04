
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


const app = express();


app.use(cors());
app.use(express.json());

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});