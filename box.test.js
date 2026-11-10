import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {newDb} from 'pg-mem';
import {initBox,mountBox,validateCatalog} from './box.js';
const secret='test-secret-'.repeat(5);
const game={id:'rbx-ps3-pes-2013',platform:'ps3',title:'PES 2013',description:'Futebol',downloadUrl:'https://drive.google.com/file/d/example/view',coverUrl:'https://example.org/pes.jpg'};
test('catálogo recusa IDs duplicados, plataformas desconhecidas e URLs inseguras',()=>{
 assert.equal(validateCatalog({games:[game]}).games.length,1);
 for(const games of [[game,game],[{...game,platform:'ps4'}],[{...game,downloadUrl:'javascript:alert(1)'}],[{...game,coverUrl:'file:///etc/passwd'}]])assert.throws(()=>validateCatalog({games}));
});
test('ativação, vínculo, revogação, isolamento e revisões de catálogo',async()=>{
 const memory=newDb({noAstCoverageCheck:true}); const {Pool}=memory.adapters.createPg();const db=new Pool();await initBox(db);await initBox(db);
 const app=express();app.use(express.json());
 const adminAuth=(req,res,next)=>{try{const p=jwt.verify(String(req.headers.authorization||'').replace('Bearer ',''),secret);if(p.sub!=='admin'||p.type)throw Error();next()}catch{res.status(401).json({error:'Não autorizado'})}};
 mountBox(app,{db,secret,adminAuth,limiter:(req,res,next)=>next()});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
 const admin=jwt.sign({sub:'admin'},secret),paid=jwt.sign({type:'paid_access'},secret),hwid='a'.repeat(64),other='b'.repeat(64);
 async function request(path,body,token){const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()}}
 try{
  assert.equal((await request('/api/admin/box/keys',{duration_days:0})).status,401);
  assert.equal((await request('/api/admin/box/keys',{duration_days:0},paid)).status,401);
  const made=await request('/api/admin/box/keys',{duration_days:0},admin);assert.equal(made.status,200);const {key,id}=made.data;
  assert.ok(key.startsWith('BOX-'));
  assert.equal((await request('/api/box/activate',{key:'RBX-AAAA-BBB',hwid})).status,400);
  const active=await request('/api/box/activate',{key,hwid});assert.equal(active.status,200);const token=active.data.token;
  assert.equal((await request('/api/box/activate',{key,hwid:other})).status,403);
  assert.equal((await request('/api/admin/box/keys',undefined,token)).status,401);
  assert.equal((await request('/api/box/catalog')).status,401);
  assert.equal((await request('/api/admin/box/catalog',{revision:'0',games:[game]},admin)).status,200);
  const catalog=await request('/api/box/catalog',undefined,token);assert.equal(catalog.data.games[0].id,game.id);assert.equal(catalog.data.revision,'1');
  assert.equal((await request('/api/admin/box/catalog',{revision:'0',games:[]},admin)).status,409);
  assert.equal((await request('/api/admin/box/keys/'+id+'/revoke',{},admin)).status,200);
  assert.equal((await request('/api/box/session',undefined,token)).status,403);
  await request('/api/admin/box/keys/'+id+'/reactivate',{},admin);await request('/api/admin/box/keys/'+id+'/reset',{},admin);
  assert.equal((await request('/api/box/session',undefined,token)).status,403);
  assert.equal((await request('/api/box/activate',{key,hwid:other})).status,200);
  await db.query('UPDATE box_keys SET expires_at=$1 WHERE id=$2',[new Date(Date.now()-1000),id]);
  assert.equal((await request('/api/box/activate',{key,hwid:other})).status,403);
  const stored=(await db.query('SELECT * FROM box_keys')).rows[0];assert.notEqual(stored.key_hash,key);assert.ok(!('key' in stored));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await db.end()}
});
