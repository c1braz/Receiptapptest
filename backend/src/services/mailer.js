// Email sender. With SMTP unconfigured, messages are logged and reported as
// 'simulated' so the whole reminder workflow is testable without credentials.
// Channel-abstracted: send({channel:'sms'|'push'}) slots in here later.
const nodemailer = require('nodemailer');
const config = require('../config');

let transport = null;
if (config.smtp.host) {
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

async function sendEmail({ to, subject, html, text }) {
  if (!transport) {
    console.log(`[mailer:simulated] to=${to} subject="${subject}"`);
    return 'simulated';
  }
  try {
    await transport.sendMail({ from: config.smtp.from, to, subject, html, text });
    return 'sent';
  } catch (err) {
    console.error(`[mailer:failed] to=${to}: ${err.message}`);
    return 'failed';
  }
}

module.exports = { sendEmail };
