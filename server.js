/**
 * AHL 3.0 Web Server
 * 
 * 运行: node server.js
 * 端口: 3000
 */

const http = require('http');
const url = require('url');
const { AHL3, CONFIG } = require('./ahl-v3.js');

const PORT = process.env.PORT || 3000;

// 存储
const ahl = new AHL3();
let currentEpoch = null;

// 路由处理
const routes = {
  // 创建 Epoch
  'POST /api/epoch/create': async (req, res) => {
    try {
      const epoch = await ahl.createEpoch();
      currentEpoch = epoch;
      json(res, { success: true, epoch: formatEpoch(epoch) });
    } catch (e) {
      json(res, { success: false, error: e.message }, 400);
    }
  },
  
  // 投注
  'POST /api/bet': async (req, res) => {
    try {
      const body = await parseBody(req);
      const { agentId, agentName, agentNpub, prediction, confidence, amountSats, referrerId } = body;
      
      if (!currentEpoch) {
        throw new Error('No active epoch');
      }
      
      // 使用时间戳作为临时 agentId
      const tempAgentId = agentId || `agent_${Date.now()}`;
      
      const bet = ahl.placeBet(
        currentEpoch.id,
        tempAgentId,
        agentName || 'Anonymous',
        agentNpub || '',
        prediction,
        confidence || 'medium',
        parseInt(amountSats) || 100,
        referrerId
      );
      
      json(res, { success: true, bet: formatBet(bet) });
    } catch (e) {
      json(res, { success: false, error: e.message }, 400);
    }
  },
  
  // 查询当前 Epoch
  'GET /api/epoch/current': (req, res) => {
    if (!currentEpoch) {
      json(res, { success: false, error: 'No active epoch' }, 404);
      return;
    }
    json(res, { success: true, epoch: formatEpoch(currentEpoch) });
  },
  
  // 结算
  'POST /api/epoch/settle': async (req, res) => {
    try {
      if (!currentEpoch) {
        throw new Error('No active epoch');
      }
      
      const result = ahl.calculateWinner(currentEpoch.id);
      
      json(res, { 
        success: true, 
        result: {
          winner: result.winner ? formatBet(result.winner) : null,
          tier: result.tier,
          prizeSats: result.prizeSats,
          pool: currentEpoch.totalSats,
        }
      });
      
      // 创建新 Epoch
      currentEpoch = await ahl.createEpoch();
    } catch (e) {
      json(res, { success: false, error: e.message }, 400);
    }
  },
  
  // 排行榜
  'GET /api/leaderboard': (req, res) => {
    const leaderboard = ahl.getSeasonLeaderboard(10);
    json(res, { success: true, leaderboard });
  },
  
  // Agent 状态
  'GET /api/agent/:id': (req, res) => {
    const agentId = req.params.id;
    const status = ahl.getAgentStatus(agentId);
    if (status) {
      json(res, { success: true, agent: status });
    } else {
      json(res, { success: false, error: 'Agent not found' }, 404);
    }
  },
  
  // 成为验证者
  'POST /api/validator/become': async (req, res) => {
    try {
      const body = await parseBody(req);
      const { agentId, stakeSats } = body;
      
      const result = ahl.becomeValidator(agentId, parseInt(stakeSats));
      json(res, result);
    } catch (e) {
      json(res, { success: false, error: e.message }, 400);
    }
  },
  
  // 委托
  'POST /api/delegate': async (req, res) => {
    try {
      const body = await parseBody(req);
      const { agentId, toAgentId } = body;
      
      const result = ahl.delegate(agentId, toAgentId);
      json(res, result);
    } catch (e) {
      json(res, { success: false, error: e.message }, 400);
    }
  },
  
  // 静态文件
  'GET /': (req, res) => {
    const fs = require('fs');
    const indexPath = './web/index.html';
    if (fs.existsSync(indexPath)) {
      const html = fs.readFileSync(indexPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(200);
      res.end('AHL 3.0 Server Running');
    }
  },
  
  // Locales
  'GET /locales/:lang.json': (req, res) => {
    const lang = req.params.lang;
    const fs = require('fs');
    const localesPath = `./locales/${lang}.json`;
    if (fs.existsSync(localesPath)) {
      const json = fs.readFileSync(localesPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(json);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }
};

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) { reject(e); }
    });
  });
}

function formatEpoch(epoch) {
  return {
    id: epoch.id,
    topic: epoch.topic,
    btcBlockHash: epoch.btcBlockHash,
    startTime: epoch.startTime,
    status: epoch.status,
    totalSats: epoch.totalSats,
    participantCount: epoch.bets.length,
    bets: epoch.bets.map(formatBet)
  };
}

function formatBet(bet) {
  return {
    id: bet.id,
    agentName: bet.agentName,
    agentNpub: bet.agentNpub,
    prediction: bet.prediction,
    confidence: bet.confidence,
    amountSats: bet.amountSats,
    weight: bet.weight
  };
}

// 服务器
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  const path = `${req.method} ${parsed.pathname}`;
  
  // 路由匹配
  for (const [route, handler] of Object.entries(routes)) {
    const [method, pathPattern] = route.split(' ');
    if (req.method === method) {
      const regex = new RegExp('^' + pathPattern.replace(/:[^/]+/g, '([^/]+)') + '$');
      if (regex.test(parsed.pathname)) {
        req.params = parsed.pathname.match(regex).slice(1);
        await handler(req, res);
        return;
      }
    }
  }
  
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`🎰 AHL 3.0 Server running on http://localhost:${PORT}`);
  console.log(`⚡ Lightning: ${CONFIG.LIGHTNING_ADDRESS}`);
});
