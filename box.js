import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const platforms = new Set(['snes','ps1','ps2','ps3','switch','xbox360']);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const prefixes={ps1:'rbx-ps1-',ps2:'rbx-drive-ps2-',ps3:'rbx-ps3-',switch:'rbx-switch-',xbox360:'rbx-xbox360-',snes:'rbx-snes-'};
const hwidPattern = /^[a-f0-9]{64}$/i;
const failure = (status, message) => Object.assign(new Error(message), {status});
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
export function validateCatalog(value) {
  if (!value || !Array.isArray(value.games) || value.games.length > 5000) throw failure(400,'Catálogo inválido.');
  const ids = new Set();
  const games = value.games.map(g => {
    if (!g || !idPattern.test(g.id) || ids.has(g.id) || !platforms.has(g.platform) || typeof g.title !== 'string' || !g.title.trim() || g.title.length > 200) throw failure(400,'Confira os IDs, nomes e plataformas dos jogos.');
    if (!g.id.startsWith(prefixes[g.platform]) && !(g.platform==='ps2' && g.id==='rbx-god-of-war-ps2')) throw failure(400,'O ID deve começar com '+prefixes[g.platform]);
    ids.add(g.id);
    const result = {id:g.id,platform:g.platform,title:g.title.trim(),description:String(g.description||'').slice(0,3000)};
    for (const field of ['downloadUrl','coverUrl']) {
      if (typeof g[field] !== 'string') throw failure(400,'Cada jogo precisa de link de download e capa.');
      if(field==='coverUrl' && /^asset:[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(g[field])) {result[field]=g[field];continue;}
      let url; try {url = new URL(g[field]);} catch {throw failure(400,'Link inválido.');}
      if (url.protocol !== 'https:' || url.username || url.password) throw failure(400,'Use links HTTPS sem senha.');
      result[field] = url.href;
    }
    if (g.sha256 != null) {
      if (!/^[a-f0-9]{64}$/i.test(g.sha256)) throw failure(400,'SHA256 inválido.');
      result.sha256=g.sha256.toLowerCase();
    }
    return result;
  });
  return {schemaVersion:1,games};
}
export async function initBox(db,seed={schemaVersion:1,games:[]}) {
  seed=validateCatalog(seed);
  await db.query(`CREATE TABLE IF NOT EXISTS box_keys (
    id BIGSERIAL PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, key_suffix TEXT NOT NULL,
    duration_days INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'active', hwid TEXT, last_used_at TIMESTAMPTZ
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS box_catalog (
    id INTEGER PRIMARY KEY CHECK(id=1), revision BIGINT NOT NULL DEFAULT 0,
    document JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query(`INSERT INTO box_catalog(id,document) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING`,[JSON.stringify(seed)]);
}
export function mountBox(app,{db,adminAuth,secret,limiter}) {
  const boxSecret = crypto.createHmac('sha256',secret).update('rbx-box-session-v1').digest('hex');
  const keyHash = key => crypto.createHash('sha256').update(key).digest('hex');
  const tokenFor = row => jwt.sign({type:'box_session',hwid:row.hwid},boxSecret,{subject:String(row.id),audience:'rbx-box',issuer:'rbx-imperio',expiresIn:'12h',algorithm:'HS256'});
  const validRow = row => {
    if (!row || row.status !== 'active') throw failure(403,'Key inválida ou revogada.');
    if (row.expires_at && new Date(row.expires_at) <= new Date()) throw failure(403,'A key expirou.');
  };
  const authorize = asyncRoute(async(req,res,next)=>{
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    let payload;try {payload=jwt.verify(token,boxSecret,{algorithms:['HS256'],audience:'rbx-box',issuer:'rbx-imperio'});}catch{throw failure(401,'Ative o RBX BOX novamente.');}
    if(payload.type!=='box_session'||!/^\d+$/.test(payload.sub)||!hwidPattern.test(payload.hwid)) throw failure(401,'Ativação inválida.');
    const r=await db.query('SELECT * FROM box_keys WHERE id=$1',[payload.sub]);
    validRow(r.rows[0]);
    if(r.rows[0].hwid!==payload.hwid)throw failure(403,'Key vinculada a outro computador.');
    req.boxKey=r.rows[0];next();
  });
  app.post('/api/box/activate',limiter,asyncRoute(async(req,res)=>{
    const key=String(req.body?.key||'').trim().toUpperCase();
    const hwid=String(req.body?.hwid||'').trim().toLowerCase();
    if(!/^BOX-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$/.test(key)||!hwidPattern.test(hwid))throw failure(400,'Informe uma key BOX válida.');
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      const r=await client.query('SELECT * FROM box_keys WHERE key_hash=$1 FOR UPDATE',[keyHash(key)]);
      const row=r.rows[0];validRow(row);
      if(row.hwid&&row.hwid!==hwid)throw failure(403,'Key vinculada a outro computador.');
      await client.query('UPDATE box_keys SET hwid=$1,last_used_at=NOW() WHERE id=$2',[hwid,row.id]);
      row.hwid=hwid;await client.query('COMMIT');
      res.setHeader('Cache-Control','no-store');res.json({ok:true,token:tokenFor(row),expires_at:row.expires_at,product:'rbx-box'});
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }));
  app.get('/api/box/catalog',authorize,asyncRoute(async(req,res)=>{
    const r=await db.query('SELECT revision,document,updated_at FROM box_catalog WHERE id=1');
    const row=r.rows[0];res.setHeader('Cache-Control','no-store');res.json({...row.document,revision:String(row.revision),updatedAt:row.updated_at});
  }));
  app.get('/api/box/session',authorize,(req,res)=>res.json({ok:true,expires_at:req.boxKey.expires_at}));
  app.post('/api/admin/box/keys',adminAuth,asyncRoute(async(req,res)=>{
    const days=Number(req.body?.duration_days);
    if(![0,1,7,30,90,365].includes(days))throw failure(400,'Validade inválida.');
    const raw='BOX-'+crypto.randomBytes(12).toString('hex').toUpperCase().match(/.{8}/g).join('-');
    const expires=days?new Date(Date.now()+days*86400000):null;
    const r=await db.query(`INSERT INTO box_keys(key_hash,key_suffix,duration_days,expires_at) VALUES($1,$2,$3,$4) RETURNING id,created_at`,[keyHash(raw),raw.slice(-8),days,expires]);
    res.setHeader('Cache-Control','no-store');res.json({...r.rows[0],key:raw,expires_at:expires,status:'active'});
  }));
  app.get('/api/admin/box/keys',adminAuth,asyncRoute(async(req,res)=>{
    const r=await db.query('SELECT id,key_suffix,duration_days,created_at,expires_at,status,hwid,last_used_at FROM box_keys ORDER BY id DESC LIMIT 1000');res.json(r.rows);
  }));
  for(const action of ['revoke','reactivate','reset'])app.post('/api/admin/box/keys/:id/'+action,adminAuth,asyncRoute(async(req,res)=>{
    if(!/^\d+$/.test(req.params.id))throw failure(400,'ID inválido.');
    const sql=action==='reset'?'UPDATE box_keys SET hwid=NULL WHERE id=$1 RETURNING id':"UPDATE box_keys SET status=$2 WHERE id=$1 RETURNING id";
    const r=await db.query(sql,action==='reset'?[req.params.id]:[req.params.id,action==='revoke'?'revoked':'active']);
    if(!r.rowCount)throw failure(404,'Key não encontrada.');res.json({ok:true});
  }));
  app.get('/api/admin/box/catalog',adminAuth,asyncRoute(async(req,res)=>{
    const r=await db.query('SELECT revision,document,updated_at FROM box_catalog WHERE id=1');res.json({...r.rows[0].document,revision:String(r.rows[0].revision),updatedAt:r.rows[0].updated_at});
  }));
  app.post('/api/admin/box/catalog',adminAuth,asyncRoute(async(req,res)=>{
    const document=validateCatalog(req.body);
    if(!/^\d+$/.test(String(req.body.revision)))throw failure(400,'Recarregue o catálogo antes de publicar.');
    const r=await db.query(`UPDATE box_catalog SET document=$1::jsonb,revision=revision+1,updated_at=NOW() WHERE id=1 AND revision=$2 RETURNING revision,updated_at`,[JSON.stringify(document),req.body.revision]);
    if(!r.rowCount)throw failure(409,'O catálogo mudou. Recarregue a página antes de publicar novamente.');
    res.json({ok:true,revision:String(r.rows[0].revision),updatedAt:r.rows[0].updated_at});
  }));
  app.use(['/api/box','/api/admin/box'],(err,req,res,next)=>{
    if(!err.status)console.error('RBX BOX:',err);
    res.status(err.status||500).json({ok:false,error:err.status?err.message:'Não foi possível concluir. Tente novamente.'});
  });
}
