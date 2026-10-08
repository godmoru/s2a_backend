async function recordAuditEvent(client, { actorUserId, action, entityType, entityId = null, metadata = {} }) {
  await client.query(
    `INSERT INTO audit_events
       (actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorUserId || null, action, entityType, entityId === null ? null : String(entityId), JSON.stringify(metadata)],
  );
}

module.exports = { recordAuditEvent };
