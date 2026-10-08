const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function fixture() {
  let now = 10000, calls = 0, people = [{id: 77, username: 'Alice'}], unavailable = false;
  const exports = {};
  const context = {exports, URL, AbortSignal, Date: {now: () => now}, process: {env: {
    FJORDHUB_URL: 'https://hub.test', FJORDHUB_APP_ID: 'fixture-app', FJORDHUB_API_KEY: 'fixture-key'
  }}, fetch: async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://hub.test');
    assert.equal(url.searchParams.get('app_id'), 'fixture-app');
    assert.equal(options.headers['X-Hub-Key'], 'fixture-key');
    if (unavailable) throw new Error('Network unavailable');
    return {ok: true, json: async () => ({ok: true, items: people})};
  }};
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/hub-access.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, context);
  return {access: exports.hubAccess, expire: () => {now += 5001;}, revoke: () => {people = [];},
    grant: () => {people = [{id: 77, username: 'Renamed'}];}, fail: () => {unavailable = true;}, calls: () => calls};
}

test('bounded membership cache rejects removal and accepts fresh regrant by stable identity', async () => {
  const f = fixture();
  assert.equal(await f.access({id:77}), 'allowed');
  assert.equal(await f.access({username:'alice'}), 'allowed');
  assert.equal(f.calls(), 1);
  f.revoke(); f.expire();
  assert.equal(await f.access({id:77}), 'revoked');
  f.grant();
  assert.equal(await f.access({id:77}), 'allowed');
  assert.equal(await f.access({id:88, username:'Renamed'}), 'revoked');
});

test('Hub outage cannot authorize stale membership and is distinct from removal', async () => {
  const f = fixture();
  assert.equal(await f.access({id:77}), 'allowed');
  f.fail(); f.expire();
  assert.equal(await f.access({id:77}), 'unavailable');
});

test('concurrent membership checks share one Hub request', async () => {
  const f = fixture();
  assert.deepEqual(await Promise.all([f.access({id:77}), f.access({id:77})]), ['allowed', 'allowed']);
  assert.equal(f.calls(), 1);
});
