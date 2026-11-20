// 只读 HTTP 服务：把证据台账、会审结论、补查清单和溯源视图提供给前端。
// 专家操作（优先处置、取消预约、地点待核）通过 /api/decisions 接收，返回操作后的新规划，不落盘改原始资料。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { buildState, explainClaim, applyExpertDecision } from './app.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', 'web');
const state = buildState();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function json(res, payload, status = 200) {
  res.writeHead(status, { 'content-type': MIME['.json'] });
  res.end(JSON.stringify(payload));
}

async function serveStatic(req, res) {
  const pathname = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const safe = pathname.replace(/\.\.|%2e/gi, '');
  try {
    const body = await readFile(join(webRoot, safe));
    res.writeHead(200, { 'content-type': MIME[extname(safe)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('未找到页面');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);

  if (req.method === 'GET' && url.pathname === '/api/state') {
    return json(res, {
      parseWarnings: state.parseWarnings,
      pendingPlace: state.ledger.pendingPlace,
      entries: state.ledger.entries,
      gaps: state.ledger.gaps,
      decisions: state.decisions,
      briefing: state.briefing,
      plan: state.plan,
      plots: state.bundle.plots,
      methods: state.bundle.methods,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/claim') {
    const detail = explainClaim(state, url.searchParams.get('id'));
    return detail ? json(res, detail) : json(res, { error: '未找到该结论' }, 404);
  }

  if (req.method === 'GET' && url.pathname === '/api/note') {
    const noteId = url.searchParams.get('id');
    const note = state.bundle.notes.find(row => row.id === noteId);
    if (!note) return json(res, { error: '未找到手记' }, 404);
    const survey = state.bundle.surveys.find(row => row.id === note.survey);
    return json(res, {
      note,
      survey,
      statements: state.statements.filter(s => s.noteId === noteId),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/decisions') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const action = JSON.parse(body);
        const nextPlan = applyExpertDecision(state.plan, action);
        return json(res, { ok: true, plan: nextPlan });
      } catch (error) {
        return json(res, { ok: false, error: error.message }, 400);
      }
    });
    return;
  }

  return json(res, { error: '未知接口' }, 404);
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => {
  console.log(`生态论证简报服务已启动：http://localhost:${port}`);
});

export { server };
