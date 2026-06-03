// api/scores.js — Vercel Serverless Function (Node.js, CommonJS, sin dependencias)
// Leaderboard GLOBAL de "Super Dachshund Bros".
//
//   GET  /api/scores
//        -> top 10: [{name,char,world,level,bones,result,country,city,ts}, ...]
//
//   POST /api/scores   (body JSON: {name,char,world,level,bones,result})
//        -> guarda la partida. El país/ciudad se toman del request (Vercel),
//           NO se guarda la IP en crudo.
//
// BASE DE DATOS: Upstash Redis vía su API REST.
//   En Vercel: pestaña Storage -> Marketplace -> Upstash (Redis). Al conectarlo
//   a tu proyecto, Vercel inyecta solas las variables de entorno. Este código
//   acepta tanto los nombres KV_REST_API_* como UPSTASH_REDIS_REST_*.
//   No hace falta package.json ni instalar nada: usa fetch nativo de Node.

const REDIS_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const LB_KEY = 'sdb_leaderboard';   // clave del sorted set en Redis
const KEEP_TOP = 200;               // cuántas entradas conservar como máximo

// Ejecuta un comando Redis contra la API REST de Upstash.
async function redis(command){
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + REDIS_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  if(!res.ok) throw new Error('redis http ' + res.status);
  const data = await res.json();
  return data.result;
}

function clampInt(v, min, max, def){
  const n = parseInt(v, 10);
  if(isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function clampStr(v, max){
  if(typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
function decodeHeader(v){
  if(!v) return '';
  try { return decodeURIComponent(v); } catch(e){ return String(v); }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if(!REDIS_URL || !REDIS_TOKEN){
    res.status(500).json({ error: 'Base de datos no configurada (faltan variables de entorno)' });
    return;
  }

  try {
    // ───── LEER: top 10 ─────
    if(req.method === 'GET'){
      const flat = await redis(['ZREVRANGE', LB_KEY, '0', '9', 'WITHSCORES']);
      const out = [];
      if(Array.isArray(flat)){
        for(let i = 0; i < flat.length; i += 2){
          let entry = {};
          try { entry = JSON.parse(flat[i]); } catch(e){ entry = {}; }
          entry.bones = Number(flat[i + 1]) || entry.bones || 0;
          out.push(entry);
        }
      }
      res.status(200).json(out);
      return;
    }

    // ───── GUARDAR una partida ─────
    if(req.method === 'POST'){
      let body = req.body;
      if(typeof body === 'string'){ try { body = JSON.parse(body); } catch(e){ body = {}; } }
      if(!body || typeof body !== 'object') body = {};

      const name   = clampStr(body.name, 20) || 'Anónimo';
      const char   = body.char === 'doverman' ? 'doverman' : 'wiener';
      const world  = clampInt(body.world, 1, 9, 1);
      const level  = clampInt(body.level, 1, 9, 1);
      const bones  = clampInt(body.bones, 0, 10000000, 0);
      const result = body.result === 'won' ? 'won' : 'lost';

      // Geolocalización aproximada que Vercel agrega al request (sin guardar la IP)
      const country = clampStr(decodeHeader(req.headers['x-vercel-ip-country']), 2);
      const city    = clampStr(decodeHeader(req.headers['x-vercel-ip-city']), 40);

      const member = JSON.stringify({
        name, char, world, level, result, country, city, ts: Date.now()
      });

      // Guardar y recortar para quedarnos sólo con los mejores KEEP_TOP
      await redis(['ZADD', LB_KEY, String(bones), member]);
      await redis(['ZREMRANGEBYRANK', LB_KEY, '0', String(-(KEEP_TOP + 1))]);

      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch(err){
    res.status(500).json({ error: 'Error del servidor' });
  }
};
