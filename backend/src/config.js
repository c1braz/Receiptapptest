const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const root = path.join(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:4000',
  databasePath: process.env.DATABASE_PATH || path.join(root, 'data', 'app.db'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(root, 'uploads'),
  jotform: {
    apiBase: 'https://api.jotform.com',
    apiKey: process.env.JOTFORM_API_KEY || '',
    formId: process.env.JOTFORM_FORM_ID || '',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Receipts Bot <no-reply@localhost>',
  },
};
