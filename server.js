/**
 * server.js — Pavlos Google MCP Server (Cloud Edition)
 * Για: pavlospaparas18@gmail.com
 * Env vars που χρειάζεται:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, PORT
 */
const http = require('http');
const { google } = require('googleapis');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const PORT          = parseInt(process.env.PORT) || 3000;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('[ERROR] Missing env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN');
  process.exit(1);
}

const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
auth.setCredentials({ refresh_token: REFRESH_TOKEN });
auth.on('tokens', (tokens) => {
  if (tokens.refresh_token) auth.setCredentials({ ...auth.credentials, refresh_token: tokens.refresh_token });
  console.log('[Auth] Tokens refreshed OK');
});

async function verifyAuth() {
  try {
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.getProfile({ userId: 'me' });
    console.log('[Auth] Connected to pavlospaparas18@gmail.com');
  } catch (err) {
    console.error('[Auth] Auth failed:', err.message);
  }
}

async function toolSearch(query, maxResults = 10) {
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
  const messages = res.data.messages || [];
  const results = [];
  for (const msg of messages) {
    const detail = await gmail.users.messages.get({
      userId: 'me', id: msg.id, format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date', 'To']
    });
    const h = detail.data.payload.headers;
    const get = (n) => h.find(x => x.name === n)?.value || '';
    results.push({ id: msg.id, threadId: msg.threadId, subject: get('Subject'), from: get('From'), to: get('To'), date: get('Date'), snippet: detail.data.snippet });
  }
  return results;
}

async function toolGetThread(threadId) {
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  return res.data;
}

async function toolSendEmail(to, subject, body, cc) {
  const gmail = google.gmail({ version: 'v1', auth });
  const lines = [
    'To: ' + to,
    cc ? 'Cc: ' + cc : null,
    'From: pavlospaparas18@gmail.com',
    'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=',
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body
  ].filter(Boolean).join('\r\n');
  const encoded = Buffer.from(lines).toString('base64url');
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
  return { messageId: res.data.id, status: 'sent' };
}

async function toolDriveSearch(query, maxResults = 10) {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.list({ q: query, pageSize: maxResults, fields: 'files(id,name,mimeType,modifiedTime,webViewLink)' });
  return res.data.files || [];
}

async function toolCalendarList(timeMin, timeMax, maxResults = 10) {
  const cal = google.calendar({ version: 'v3', auth });
  const res = await cal.events.list({ calendarId: 'primary', timeMin: timeMin || new Date().toISOString(), timeMax, maxResults, singleEvents: true, orderBy: 'startTime' });
  return res.data.items || [];
}

const TOOLS = [
  { name: 'pavlos_gmail_search', description: 'Search emails in pavlospaparas18@gmail.com. Use Gmail query syntax.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'number' } }, required: ['query'] } },
  { name: 'pavlos_gmail_get_thread', description: 'Read a full email thread.', inputSchema: { type: 'object', properties: { threadId: { type: 'string' } }, required: ['threadId'] } },
  { name: 'pavlos_gmail_send', description: 'Send email from pavlospaparas18@gmail.com.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, cc: { type: 'string' } }, required: ['to', 'subject', 'body'] } },
  { name: 'pavlos_drive_search', description: 'Search files in Google Drive of pavlospaparas18@gmail.com.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'number' } }, required: ['query'] } },
  { name: 'pavlos_calendar_list', description: 'List events from Google Calendar of pavlospaparas18@gmail.com.', inputSchema: { type: 'object', properties: { timeMin: { type: 'string' }, timeMax: { type: 'string' }, maxResults: { type: 'number' } }, required: [] } }
];

async function handleMcpRequest(req) {
  const { id, method, params } = req;
  if (method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'pavlos-google-mcp', version: '2.0.0' } } };
  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      let result;
      if      (name === 'pavlos_gmail_search')     result = await toolSearch(args.query, args.maxResults);
      else if (name === 'pavlos_gmail_get_thread')  result = await toolGetThread(args.threadId);
      else if (name === 'pavlos_gmail_send')        result = await toolSendEmail(args.to, args.subject, args.body, args.cc);
      else if (name === 'pavlos_drive_search')      result = await toolDriveSearch(args.query, args.maxResults);
      else if (name === 'pavlos_calendar_list')     result = await toolCalendarList(args.timeMin, args.timeMax, args.maxResults);
      else throw new Error('Unknown tool: ' + name);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
    } catch (err) {
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Error: ' + err.message }], isError: true } };
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } };
}

const clients = new Map();
let clientIdCounter = 0;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', server: 'pavlos-google-mcp', version: '2.0.0', uptime: process.uptime() }));
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Pavlos Google MCP Server v2.0 — /sse for MCP, /health for status');
    return;
  }

  if (req.method === 'GET' && req.url === '/sse') {
    const id = ++clientIdCounter;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    clients.set(id, res);
    res.write('event: endpoint\ndata: /messages?clientId=' + id + '\n\n');
    const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { clearInterval(keepAlive); clients.delete(id); } }, 25000);
    req.on('close', () => { clients.delete(id); clearInterval(keepAlive); });
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/messages')) {
    const urlParams = new URL(req.url, 'http://localhost:' + PORT).searchParams;
    const clientId = parseInt(urlParams.get('clientId'));
    const sseRes = clients.get(clientId);
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      res.writeHead(202); res.end('Accepted');
      try {
        const mcpReq = JSON.parse(body);
        const mcpRes = await handleMcpRequest(mcpReq);
        if (mcpRes && sseRes) sseRes.write('event: message\ndata: ' + JSON.stringify(mcpRes) + '\n\n');
      } catch (e) {
        if (sseRes) sseRes.write('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n\n');
      }
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log('Pavlos Google MCP Server v2.0 running on port ' + PORT);
  await verifyAuth();
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
