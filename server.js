import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createApp} from './app.js';
import {initBox} from './box.js';

const required=['BOX_DATABASE_URL','BOX_ADMIN_USER','BOX_ADMIN_PASSWORD','BOX_JWT_SECRET'];
for(const name of required)if(!process.env[name])throw Error(`Configure ${name} no serviço exclusivo do BOX.`);
const db=new pg.Pool({connectionString:process.env.BOX_DATABASE_URL,max:5,connectionTimeoutMillis:15000,...(process.env.BOX_DATABASE_SSL==='true'?{ssl:{rejectUnauthorized:true}}:{})});
try {
 const app=createApp({db,adminUser:process.env.BOX_ADMIN_USER,adminPassword:process.env.BOX_ADMIN_PASSWORD,secret:process.env.BOX_JWT_SECRET});
 const seed=JSON.parse(readFileSync(new URL('./box-seed.json',import.meta.url),'utf8'));
 await initBox(db,seed);
 const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('RBX BOX Server iniciado.'));
 let closing=false;
 const shutdown=()=>{if(closing)return;closing=true;server.close(()=>db.end().then(()=>process.exit(0)));setTimeout(()=>process.exit(1),10000).unref()};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}catch(error){console.error('Não foi possível iniciar o servidor BOX:',error.message);await db.end();process.exit(1);}
