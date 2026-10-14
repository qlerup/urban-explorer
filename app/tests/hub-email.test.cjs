const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function fixture() {
  const calls = [];
  let active = true, member = {id:77, email_required:true};
  const auth = {getSession:async options => {assert.equal(options.allowEmailRequired,true);return active ? {hubUserId:77} : null;}, getHubIdentity:async session => ({id:session.hubUserId})};
  const access = {hubManaged:() => true, hubMember:async (identity,fresh) => {assert.equal(identity.id,77);assert.equal(fresh,true);return member;},clearHubAccess:() => calls.push('clear')};
  const hub = {hubRequest:async (path,payload) => {calls.push({path,payload});return {ok:true,accepted:payload.email!=='duplicate@example.test'};}};
  const modules = {'@/lib/auth':auth,'@/lib/hub-access':access,'@/lib/fjordhub':hub,'next/server':{NextResponse:{json:(body,options) => ({body,status:options?.status||200})}}};
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname,'../src/app/api/auth/email/route.ts'),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,URL,require:name => modules[name]});
  const request = (body,origin='https://app.test') => ({headers:new Headers({Origin:origin,Host:'app.test'}),json:async()=>body});
  return {post:exports.POST,request,calls,logout:()=>{active=false;},revoke:()=>{member=null;}};
}

test('pending authenticated user updates its own stable identity and ignores submitted user ID',async()=>{
  const f=fixture();
  const result=await f.post(f.request({email:'new@example.test',id:999}));
  assert.equal(result.body.accepted,true);
  assert.equal(f.calls[0].path,'/api/hub/apps/users/77/email');
  assert.equal(JSON.stringify(f.calls[0].payload),JSON.stringify({email:'new@example.test'}));
  assert.equal(f.calls[1],'clear');
});
test('cross-origin, anonymous and revoked writes cannot reach the central email endpoint',async()=>{
  const f=fixture();
  assert.equal((await f.post(f.request({email:'new@example.test'},'https://evil.test'))).status,403);
  f.logout();assert.equal((await f.post(f.request({email:'new@example.test'}))).status,401);
  assert.equal(f.calls.length,0);
  const revoked=fixture();revoked.revoke();assert.equal((await revoked.post(revoked.request({email:'new@example.test'}))).status,401);
  assert.equal(revoked.calls.length,0);
});
test('validation failure is preserved and does not report successful completion',async()=>{
  const f=fixture();
  assert.equal((await f.post(f.request({email:[]}))).status,400);
  assert.equal((await f.post(f.request({email:'duplicate@example.test'}))).body.accepted,false);
});
