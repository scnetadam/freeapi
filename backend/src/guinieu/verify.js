// ============================================================
// guinieu/verify.js  —  龟纽印信 · 导出包校验器
// 龟钮印证后端集成版
// ============================================================
const crypto = require('crypto');

function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function verifyBundle(bundle) {
    const results = [];
    let overallValid = true;

    if (bundle.schema !== 'guinieu:v1') {
        results.push({ check: 'schema', status: 'FAIL', detail: `期望 guinieu:v1，实际 ${bundle.schema}` });
        overallValid = false;
    } else {
        results.push({ check: 'schema', status: 'PASS', detail: 'guinieu:v1' });
    }

    const requiredFields = ['credential_id', 'issued_at', 'events', 'verify_note'];
    for (const field of requiredFields) {
        if (bundle[field] === undefined) {
            results.push({ check: `field:${field}`, status: 'FAIL', detail: '缺少必填字段' });
            overallValid = false;
        }
    }

    const events = bundle.events || [];
    if (events.length === 0) {
        results.push({ check: 'event_count', status: 'FAIL', detail: '事件列表为空' });
        return { valid: false, results, summary: { passed: 0, failed: 1, warn: 0, total: 1 } };
    }
    results.push({ check: 'event_count', status: 'PASS', detail: `${events.length} 个事件` });

    let eventIdSet = new Set();
    let chainBroken = false;

    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const idx = i + 1;

        if (!ev.event_id || typeof ev.event_id !== 'string') {
            results.push({ check: `event[${idx}].event_id`, status: 'FAIL', detail: '缺失或非字符串' });
            overallValid = false; chainBroken = true; break;
        }
        if (eventIdSet.has(ev.event_id)) {
            results.push({ check: `event[${idx}].event_id`, status: 'FAIL', detail: `重复 event_id: ${ev.event_id}` });
            overallValid = false; chainBroken = true; break;
        }
        eventIdSet.add(ev.event_id);

        if (!ev.payload_hash || !ev.payload_hash.startsWith('sha256:')) {
            results.push({ check: `event[${idx}].payload_hash`, status: 'FAIL', detail: `格式错误: ${ev.payload_hash || '(空)'}` });
            overallValid = false; chainBroken = true; break;
        }

        const expectedPrev = (i === 0) ? null : events[i - 1].event_id;
        if (ev.prev_event_id !== expectedPrev) {
            results.push({
                check: `event[${idx}].prev_event_id`, status: 'FAIL',
                detail: `期望 ${expectedPrev || 'null'}，实际 ${ev.prev_event_id || 'null'}`,
            });
            overallValid = false; chainBroken = true; break;
        }
    }

    if (chainBroken) {
        return { valid: overallValid, results, summary: { passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length, warn: 0, total: results.length } };
    }

    results.push({ check: 'chain_integrity', status: 'PASS', detail: `所有 ${events.length} 个事件链序完整` });

    const firstEvent = events[0];
    if (firstEvent.prev_event_id !== null && firstEvent.prev_event_id !== undefined) {
        results.push({ check: 'first_event_prev', status: 'FAIL', detail: `首事件 prev_event_id 应为 null，实际 ${firstEvent.prev_event_id}` });
        overallValid = false;
    } else {
        results.push({ check: 'first_event_prev', status: 'PASS', detail: '首事件 prev_event_id = null' });
    }

    if (bundle.payload_hash_aggregate) {
        const recomputed = sha256(events.map(e => e.event_id + '|' + (e.payload_hash.replace(/^sha256:/, ''))).join(';'));
        const expectedAgg = bundle.payload_hash_aggregate.replace(/^sha256:/, '');
        if (recomputed === expectedAgg) {
            results.push({ check: 'payload_hash_aggregate', status: 'PASS', detail: '聚合哈希匹配' });
        } else {
            results.push({ check: 'payload_hash_aggregate', status: 'FAIL', detail: `期望 ${expectedAgg}，复算 ${recomputed}` });
            overallValid = false;
        }
    }

    if (bundle.verify_note && bundle.verify_note.length > 0) {
        results.push({ check: 'verify_note', status: 'PASS', detail: bundle.verify_note.slice(0, 60) });
    }

    return {
        valid: overallValid, results,
        summary: {
            passed: results.filter(r => r.status === 'PASS').length,
            failed: results.filter(r => r.status === 'FAIL').length,
            warn: results.filter(r => r.status === 'WARN').length,
            total: results.length,
        },
    };
}

function formatReport(result) {
    const lines = [];
    lines.push('═══════════════════════════════════════════════');
    lines.push('  龟纽印信 · 导出包校验报告');
    lines.push('  结果: ' + (result.valid ? '✅ 有效' : '❌ 无效'));
    lines.push('═══════════════════════════════════════════════');
    for (const r of result.results) {
        const icon = r.status === 'PASS' ? '✓' : r.status === 'WARN' ? '⚠' : '✗';
        lines.push(`  [${r.status}] ${r.check}`);
        lines.push(`    ${icon} ${r.detail}`);
    }
    lines.push('── 汇总 ────────────────────────────────────────');
    const s = result.summary;
    lines.push(`  通过: ${s.passed || 0}  失败: ${s.failed || 0}  警告: ${s.warn || 0}  总计: ${s.total}`);
    lines.push('═══════════════════════════════════════════════');
    return lines.join('\n');
}

module.exports = { verifyBundle, formatReport };
