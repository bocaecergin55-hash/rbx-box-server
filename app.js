import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mountBox} from './box.js';

const publicDir=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const equal=(a,b)=>crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a||'')).digest(),crypto.createHash('sha256').update(String(b||'')).digest());
export function createApp({db,adminUser,adminPassword,secret}) {
  if(!db||!adminUser||typeof adminPassword!=='string'||adminPassword.length<12||typeof secret!=='string'||secret.length<32) throw Error('Configure as credenciais exclusivas do BOX.');
  const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
  app.use(helmet({contentSecurityPolicy:false}));
  app.use('/api/admin/box/catalog',express.json({limit:'4mb'}));
  app.use(express.json({limit:'32kb'}));
  app.use('/api/',(req,res,next)=>{res.setHeader('Cache-Control','no-store');next()});
  app.use('/api/',rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-8',legacyHeaders:false}));
  const loginLimiter=rateLimit({windowMs:60000,limit:5,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Muitas tentativas. Aguarde um minuto.'}});
  const activationLimiter=rateLimit({windowMs:60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Muitas tentativas de ativação. Aguarde um minuto.'}});
  function adminAuth(req,res,next){
    try {
      const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
      const payload=jwt.verify(token,secret,{algorithms:['HS256'],audience:'rbx-box-admin',issuer:'rbx-box-server'});
      if(payload.type!=='box_admin'||payload.sub!==adminUser)throw Error('Token inválido');
      req.admin=payload;next();
    }catch{res.status(401).json({error:'Entre no painel administrativo do BOX.'});}
  }
  app.post('/api/admin/login',loginLimiter,(req,res)=>{
    const username=String(req.body?.username||'');const password=String(req.body?.password||'');
    const userOk=equal(username,adminUser),passwordOk=equal(password,adminPassword);
    if(!userOk||!passwordOk)return res.status(401).json({error:'Usuário ou senha inválidos.'});
    res.json({token:jwt.sign({type:'box_admin'},secret,{subject:adminUser,audience:'rbx-box-admin',issuer:'rbx-box-server',algorithm:'HS256',expiresIn:'8h'})});
  });
  mountBox(app,{db,adminAuth,secret,limiter:activationLimiter});
  app.get('/health',async(_req,res)=>{try{await db.query('SELECT 1');res.json({ok:true,service:'rbx-box-server'});}catch{res.status(503).json({ok:false,service:'rbx-box-server'});}});
  app.get('/',(_req,res)=>res.redirect('/box.html'));
  app.use(express.static(publicDir));
  app.use('/api/',(_req,res)=>res.status(404).json({error:'Rota não encontrada no servidor BOX.'}));
  app.use((err,req,res,next)=>{console.error('RBX BOX:',err.message);res.status(err.status||500).json({error:err.status===413?'Envio muito grande.':'Não foi possível concluir a solicitação.'});});
  return app;
}
