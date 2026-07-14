// ============================================================
// guinieu/seal.js  —  龟纽印信 · 核心存证函数
// 龟钮印证后端集成版
// ============================================================
const crypto = require('crypto');

function computePayloadHash(payload) {
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

function generateEventId() {
    const rand = crypto.randomBytes(8).toString('hex');
    return 'evt_' + rand;
}

function sealImpress({ type, payload, prevEventId = null, createdBy, sigMethod = 'none', secretOrKey = null }) {
    const ALLOWED_TYPES = ['seal_impressed', 'auth_grant', 'proof_submit', 'settle_instruct'];
    if (!ALLOWED_TYPES.includes(type)) {
        throw new Error(`[sealImpress] 非法事件类型: ${type}。允许: ${ALLOWED_TYPES.join(', ')}`);
    }
    const payloadHash = computePayloadHash(payload);
    const eventId = generateEventId();
    const ts = new Date().toISOString().replace('Z', '+08:00');

    let sig = null;
    if (sigMethod !== 'none') {
        if (!secretOrKey) throw new Error('[sealImpress] sigMethod 指定但未提供 secretOrKey');
        const toSign = `${eventId}|${type}|${ts}|${payloadHash}|${prevEventId || ''}`;
        if (sigMethod === 'hmac-sha256') {
            sig = crypto.createHmac('sha256', secretOrKey).update(toSign).digest('hex');
        } else {
            throw new Error(`[sealImpress] 不支持的签名方法: ${sigMethod}`);
        }
    }

    return {
        event_id: eventId, type, ts,
        payload_json: JSON.stringify(payload),
        payload_hash: payloadHash,
        prev_event_id: prevEventId,
        sig_method: sigMethod, sig, status: 'active', reason: null, created_by: createdBy,
    };
}

function exportBundle({ credentialId, subject, type, events, additional = {} }) {
    const aggHash = crypto.createHash('sha256')
        .update(events.map(e => e.event_id + '|' + e.payload_hash).join(';'))
        .digest('hex');

    return {
        schema: 'guinieu:v1',
        credential_id: credentialId,
        issued_at: new Date().toISOString().replace('Z', '+08:00'),
        subject, type,
        event_count: events.length,
        events: events.map(e => ({
            event_id: e.event_id, type: e.type,
            payload_hash: `sha256:${e.payload_hash}`,
            prev_event_id: e.prev_event_id,
        })),
        payload_hash_aggregate: `sha256:${aggHash}`,
        verify_note: 'recompute sha256(payload_json) per event; follow prev_event_id chain; final hash must match.',
        ...additional,
    };
}

module.exports = { sealImpress, exportBundle, computeHash: computePayloadHash, generateEventId };
