import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from './collect.js';

test('parses bare host:port using the source default scheme', () => {
  assert.deepEqual(parse('1.2.3.4:8080', 'http'), [{ addr: '1.2.3.4:8080', scheme: 'http' }]);
});

test('an inline scheme overrides the source default', () => {
  // proxifly ships scheme://host:port while the other lists ship bare pairs.
  assert.deepEqual(parse('socks5://1.2.3.4:1080', 'http'), [
    { addr: '1.2.3.4:1080', scheme: 'socks5' },
  ]);
});

test('https entries are stored as http', () => {
  // An https:// list entry still speaks the HTTP proxy protocol; keeping the
  // literal scheme would make the agent factory pick the wrong dialer.
  assert.deepEqual(parse('https://1.2.3.4:8443', null), [
    { addr: '1.2.3.4:8443', scheme: 'http' },
  ]);
});

test('rejects malformed and out-of-range input', () => {
  const junk = [
    'not-an-ip:8080',
    '1.2.3.4', // no port
    '1.2.3.4:0', // port 0
    '1.2.3.4:70000', // port out of range
    '999.1.1.1:80', // octet > 255
    '# comment',
    '',
  ].join('\n');
  assert.deepEqual(parse(junk, 'http'), []);
});

test('lines without a scheme are dropped when the source has no default', () => {
  assert.deepEqual(parse('1.2.3.4:8080', null), []);
});

test('handles CRLF and surrounding whitespace', () => {
  assert.deepEqual(parse('  1.2.3.4:8080  \r\n5.6.7.8:1080\r\n', 'socks5'), [
    { addr: '1.2.3.4:8080', scheme: 'socks5' },
    { addr: '5.6.7.8:1080', scheme: 'socks5' },
  ]);
});
