/**
 * AHL Web Server
 * 
 * 运行: node server.js
 * 端口: 3000
 */

const http = require('http');
const url = require('url');
const { AgentHashLottery, CONFIG } = require('./index.js');

const PORT = process.env.PORT || 3000;

// 存储
const ahl = new AgentHashLottery();
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
      const { agentName, agentNpub, prediction, confidence, amountSats } = body;
      
      if (!currentEpoch) {
        throw new Error('No active epoch');
      }
      
      const bet = ahl.placeBet(
        currentEpoch.id,
        Date.now().toString(),
        agentName,
        agentNpub || '',
        prediction,
        confidence || 'medium',
        parseInt(amountSats)
      );
      
      // Nostr 广播
      await ahl.broadcastBet(currentEpoch, bet);
      
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
          pool: result.pool,
          hash: result.hash
        }
      });
      
      // 创建新 Epoch
      currentEpoch = await ahl.createEpoch();
    } catch (e) {
      json(res, { success: false, error: e.message }, 400);
    }
  },
  
  // 静态文件
  'GET /': (req, res) => {
    const indexPath = './web/index.html';
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
      const html = fs.readFileSync(indexPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('AHL Server Running. Use API endpoints.');
    }
  },
  
  // Locales
  'GET /locales/:lang.json': (req, res) => {
    const lang = req.params.lang;
    const localesPath = `./locales/${lang}.json`;
    const fs = require('fs');
    if (fs.existsSync(localesPath)) {
      const json = fs.readFileSync(localesPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(json);
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
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
      } catch (e) {
        reject(e);
      }
    });
  });
}

function formatEpoch(epoch) {
  return {
    id: epoch.id,
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
    amountSats: bet.amountSats
  };
}

// 服务器
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const path = `${req.method} ${parsed.pathname}`;
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // 路由匹配
  for (const [route, handler] of Object.entries(routes)) {
    const [method, pathPattern] = route.split(' ');
    if (req.method === method && parsed.pathname === pathPattern) {
      await handler(req, res);
      return;
    }
  }
  
  // API 前缀匹配
  for (const [route, handler] of Object.entries(routes)) {
    const [method, pathPattern] = route.split(' ');
    if (req.method === method) {
      const regex = new RegExp('^' + pathPattern.replace(/:[^/]+/g, '[^/]+') + '$');
      if (regex.test(parsed.pathname)) {
        await handler(req, res);
        return;
      }
    }
  }
  
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`🎰 AHL Server running on http://localhost:${PORT}`);
  console.log(`⚡ Lightning: ${CONFIG.LIGHTNING_ADDRESS}`);
});
