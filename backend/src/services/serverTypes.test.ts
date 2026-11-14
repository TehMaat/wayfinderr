import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasUltraApi, isServerType, serverFieldsError, unusedFields } from './serverTypes.js';

const ssh = { name: 'NAS', sshHost: '192.168.1.20', sshUsername: 'media' };
const ultra = {
  ...ssh,
  type: 'ULTRA',
  apiEndpoint: 'https://alice.zeus.usbx.me/ultra-api/get_diskquota',
  apiToken: 'secret',
};

test('server types', () => {
  assert.equal(isServerType('ULTRA'), true);
  assert.equal(isServerType('SEEDBOX'), true);
  assert.equal(isServerType('SSH'), true);
  assert.equal(isServerType('ultra'), false);
  assert.equal(isServerType(undefined), false);
  assert.equal(hasUltraApi({ type: 'ULTRA' }), true);
  assert.equal(hasUltraApi({ type: 'SSH' }), false);
});

test('Ultra.cc needs the Ultra-API endpoint and token', () => {
  assert.equal(serverFieldsError(ultra), null);
  assert.equal(serverFieldsError({ ...ultra, apiToken: null }), 'Missing: Ultra-API token');
  assert.equal(serverFieldsError({ ...ultra, apiEndpoint: '', apiToken: '' }), 'Missing: Ultra-API endpoint, Ultra-API token');
  assert.equal(serverFieldsError({ ...ultra, apiEndpoint: 'alice.zeus.usbx.me' }), 'The Ultra-API endpoint must be a http(s) URL');
});

test('a seedbox or a plain server needs only the SSH login', () => {
  assert.equal(serverFieldsError({ ...ssh, type: 'SEEDBOX' }), null);
  assert.equal(serverFieldsError({ ...ssh, type: 'SSH', apiEndpoint: null, apiToken: null }), null);
  assert.equal(serverFieldsError({ type: 'SSH', name: 'NAS' }), 'Missing: SSH host, SSH username');
});

test('an unknown type', () => {
  assert.match(serverFieldsError({ ...ssh, type: 'FTP' })!, /^Unknown server type/);
  assert.match(serverFieldsError(ssh)!, /^Unknown server type/);
});

test('a server that stops being Ultra.cc loses its API settings', () => {
  assert.deepEqual(unusedFields('ULTRA'), {});
  assert.deepEqual(unusedFields('SSH'), {
    apiEndpoint: null,
    apiToken: null,
    autoRestartApi: false,
    apiRestartAt: null,
    apiRestartError: null,
  });
});
