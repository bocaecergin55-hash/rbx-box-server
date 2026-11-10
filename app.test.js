import {test} from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {newDb} from 'pg-mem';
import {createApp} from './app.js';
import {initBox} from './box.js';

test('servidor independente exige segredos exclusivos válidos',()=>{
 assert.throws(()=>createApp({db:{},adminUser:'admin',adminPassword:'curta',secret:'curto'}));
});
test('painel independente, isolamento dos tokens e ausência das rotas Steam/Pix',async()=>{
 const mem=newDb({noAstCoverageCheck:true});const {Pool}=mem.adapters.createPg();const db=new Pool();await initBox(db);
 const secret='box-test-secret-'.repeat(4);const app=createApp({db,adminUser:'box-admin',adminPassword:'senha-box-teste-1234',secret});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 async function request(route,body,token){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()}}
 try{
  assert.equal((await request('/health')).data.service,'rbx-box-server');
  assert.equal((await request('/api/admin/login',{username:'box-admin',password:'errada'})).status,401);
  const auth=await request('/api/admin/login',{username:'box-admin',password:'senha-box-teste-1234'});assert.equal(auth.status,200);const admin=auth.data.token;
  const steam=jwt.sign({sub:'box-admin'},'steam-independent-secret');const paid=jwt.sign({type:'paid_access',sub:'box-admin'},secret);
  for(const t of [steam,paid])assert.equal((await request('/api/admin/box/keys',undefined,t)).status,401);
  const made=await request('/api/admin/box/keys',{duration_days:0},admin);assert.equal(made.status,200);
  const active=await request('/api/box/activate',{key:made.data.key,hwid:'a'.repeat(64)});assert.equal(active.status,200);
  assert.equal((await request('/api/admin/box/keys',undefined,active.data.token)).status,401);
  assert.equal((await request('/api/box/catalog',undefined,admin)).status,401);
  assert.equal((await request('/api/box/catalog',undefined,active.data.token)).status,200);
  for(const route of ['/api/validate','/api/register','/api/pix/criar','/api/admin/keys'])assert.equal((await request(route,{},admin)).status,404);
  const ui=await fetch(base+'/box.html');assert.equal(ui.status,200);assert.ok(!(await ui.text()).includes('Painel Steam'));
  const tables=(await db.query('SELECT table_name FROM information_schema.tables WHERE table_schema=\'public\'')).rows.map(r=>r.table_name).sort();assert.deepEqual(tables,['box_catalog','box_keys']);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await db.end()}
});
