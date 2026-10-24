#!/usr/bin/env node
/**
 * Forwards /api/* to the live API during local development.
 *
 * The API sends no CORS headers and answers OPTIONS with 404, so a browser on localhost
 * cannot call it directly. This proxy is a development convenience only — the deployed app
 * shares an origin with the API and does not go through anything like it.
 */
import http from 'node:http';

const TARGET = 'https://go.areagles.com';
const PORT = 8787;

http
  .createServer(async (req, res) => {
    const origin = req.headers.origin ?? '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization,content-type',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { ...req.headers, host: new URL(TARGET).host };
    delete headers.origin;
    delete headers.referer;

    try {
      const upstream = await fetch(TARGET + req.url, {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        ...cors,
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(502, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'proxy_failed', detail: String(err) }));
    }
  })
  .listen(PORT, () => console.log(`dev proxy → ${TARGET} on http://localhost:${PORT}`));
