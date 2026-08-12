import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBrowserDiagnosticSession,
  getBrowserDiagnosticSession,
  recordBrowserDiagnosticEvidence,
} from './browser-diagnostics.js';

test('browser diagnostic sessions accept and normalize browser evidence', () => {
  const session = createBrowserDiagnosticSession();
  const completed = recordBrowserDiagnosticEvidence(session.id, {
    ipv4: '203.0.113.10',
    ipv6: '2001:db8::10',
    webrtcPublic: ['203.0.113.10', 'not-an-ip'],
    webrtcPrivate: ['192.168.1.2'],
    webrtcMdns: true,
    timezone: 'Asia/Shanghai',
    language: 'zh-CN',
    languages: ['zh-CN', 'en-US'],
    userAgent: 'fixture-browser',
  });
  assert.equal(completed?.state, 'complete');
  assert.deepEqual(completed?.evidence?.webrtcPublic, ['203.0.113.10']);
  assert.equal(getBrowserDiagnosticSession(session.id)?.evidence?.timezone, 'Asia/Shanghai');
});

test('browser diagnostic sessions reject unknown ids', () => {
  assert.equal(recordBrowserDiagnosticEvidence('missing', {}), null);
});
