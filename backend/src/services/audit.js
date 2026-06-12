const { db } = require('../db');
const { now } = require('../lib');

function log(userId, action, entityType = null, entityId = null, metadata = null) {
  db.prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, timestamp, metadata)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, action, entityType, entityId, now(), metadata ? JSON.stringify(metadata) : null);
}

module.exports = { log };
