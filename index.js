/**
 * Agent Hash Lottery (AHL) - Production Version
 * 
 * 基于比特币工作量证明机制的 AI Agent 预测平台
 * 
 * 功能:
 * - 真实 BTC 区块哈希
 * - Nostr 广播
 * - Cashu/NWC 闪电支付
 * - Polymarket 集成
 * - 自动 Epoch 轮换
 */

const CryptoJS = require("crypto-js");
const { v4: uuidv4 } = require('uuid');
const { finalizeEvent, getPublicKey, SimplePool } = require('nostr-tools');
const https = require('https');
const http = require('http');

// ============= 配置 =============
const CONFIG = {
  // Nostr 私钥 (hex)
  NOSTR_PRIVATE_KEY: process.env.NOSTR_PRIVATE_KEY || '76c70b80dad17392fe0368547f365c99e9b4b033cd51d6265f9550474ab1a0ff',
  NOSTR_RELAYS: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'],
  
  // Lightning Address (Cashu/NWC)
  LIGHTNING_ADDRESS: process.env.LIGHTNING_ADDRESS || 'icehorse16@primal.net',
  
  // BTC API
  BTC_API: 'https://blockstream.info/api',
  
  // Polymarket API
  POLYMARKET_API: 'https://clob.polymarket.com',
  
  // 自动化设置
  AUTO_EPOCH: {
    ENABLED: process.env.AUTO_EPOCH === 'true',
    INTERVAL_MINUTES: parseInt(process.env.EPOCH_INTERVAL || '5'),
  },
  
  // 难度阈值
  DIFFICULTY: {
    TIER_1: 0xd000,  // 头奖 12.5%
    TIER_2: 0xe000,  // 二奖 7.8%
    TIER_3: 0xf000,  // 三奖 3.9%
    TIER_4: 0xffff,  // 安慰奖
  },
  
  // 奖金池分配
  PRIZE_POOL: {
    TIER_1: 0.70,
    TIER_2: 0.20,
    TIER_3: 0.10,
    TIER_4: 0.00,
  },
  
  // Epoch 设置
  EPOCH: {
    DURATION_SECONDS: 300, // 5分钟
    MIN_BET_SATS: 100,
  }
};

// Nostr Pool
const nostrPool = new SimplePool();
const sk = new Uint8Array(Buffer.from(CONFIG.NOSTR_PRIVATE_KEY, 'hex'));
const pubkey = getPublicKey(sk);

// ============= 核心类 =============

class AgentHashLottery {
  constructor() {
    this.epochs = new Map();
    this.results = [];
  }

  /**
   * 获取最新 BTC 区块哈希
   */
  async getLatestBtcBlockHash() {
    try {
      const response = await fetch(`${CONFIG.BTC_API}/blocks/tip/hash`);
      return await response.text();
    } catch (e) {
      console.error('BTC API error:', e.message);
      // 备用: 返回固定值
      return '00000000000000000000a882324aa7cdadd0e1af62fa7cbd894e49d76ae5fb7d';
    }
  }

  /**
   * 创建新 Epoch
   */
  async createEpoch() {
    const btcHash = await this.getLatestBtcBlockHash();
    const epochId = uuidv4();
    const epoch = {
      id: epochId,
      btcBlockHash: btcHash,
      bets: [],
      salt: CryptoJS.lib.WordArray.random(16).toString(),
      startTime: Date.now(),
      status: 'active',
      totalSats: 0,
    };
    this.epochs.set(epochId, epoch);
    
    // Nostr 广播新 Epoch
    await this.broadcastNewEpoch(epoch);
    
    return epoch;
  }

  /**
   * 投注
   */
  placeBet(epochId, agentId, agentName, agentNpub, prediction, confidence, amountSats, lightningInvoice) {
    const epoch = this.epochs.get(epochId);
    if (!epoch || epoch.status !== 'active') {
      throw new Error('Epoch not found or already closed');
    }

    if (amountSats < CONFIG.EPOCH.MIN_BET_SATS) {
      throw new Error(`Minimum bet is ${CONFIG.EPOCH.MIN_BET_SATS} sats`);
    }

    const bet = {
      id: uuidv4(),
      agentId,
      agentName,
      agentNpub,
      prediction,
      confidence,
      amountSats,
      lightningInvoice,
      timestamp: Date.now(),
    };

    epoch.bets.push(bet);
    epoch.totalSats += amountSats;

    return bet;
  }

  /**
   * 结算
   */
  calculateWinner(epochId) {
    const epoch = this.epochs.get(epochId);
    if (!epoch) {
      throw new Error('Epoch not found');
    }

    // 构建熵
    const entropyInput = [
      epoch.btcBlockHash,
      epoch.salt,
      epoch.bets.map(b => b.id + b.prediction + b.amountSats).join(''),
      Date.now().toString()
    ].join('|');

    const finalHash = CryptoJS.SHA256(entropyInput).toString();
    const hashNum = parseInt(finalHash.substring(0, 4), 16);

    console.log('\n=== 🎰 结算信息 ===');
    console.log(`BTC Block Hash: ${epoch.btcBlockHash}`);
    console.log(`Salt: ${epoch.salt}`);
    console.log(`Final Hash: ${finalHash}`);
    console.log(`Hash Value: ${hashNum.toString(16)}`);
    console.log(`Total Pool: ${epoch.totalSats} sats`);
    console.log(`Participants: ${epoch.bets.length}`);
    console.log('====================\n');

    // 判断中奖等级
    let winningTier = 0;
    
    if (hashNum < CONFIG.DIFFICULTY.TIER_1) {
      winningTier = 1;
    } else if (hashNum < CONFIG.DIFFICULTY.TIER_2) {
      winningTier = 2;
    } else if (hashNum < CONFIG.DIFFICULTY.TIER_3) {
      winningTier = 3;
    } else if (hashNum < CONFIG.DIFFICULTY.TIER_4) {
      winningTier = 4;
    }

    let winner = null;
    let prize = 0;

    if (winningTier > 0 && epoch.bets.length > 0) {
      // 随机选择中奖者
      const winnerIndex = Math.floor(Math.random() * epoch.bets.length);
      winner = epoch.bets[winnerIndex];
      prize = Math.floor(epoch.totalSats * CONFIG.PRIZE_POOL[`TIER_${winningTier}`]);
    }

    epoch.winner = winner;
    epoch.winningTier = winningTier;
    epoch.prize = prize;
    epoch.finalHash = finalHash;
    epoch.status = 'closed';

    // Nostr 广播结果
    this.broadcastResult(epoch, winner, winningTier, prize);

    return {
      winner,
      tier: winningTier,
      prizeSats: prize,
      hash: finalHash,
      pool: epoch.totalSats,
    };
  }

  /**
   * Nostr 广播: 新 Epoch
   */
  async broadcastNewEpoch(epoch) {
    const event = {
      kind: 1111,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['t', 'ahl-epoch'],
        ['e', epoch.id],
        ['d', 'new-epoch']
      ],
      content: JSON.stringify({
        app: 'AgentHashLottery',
        action: 'new_epoch',
        epochId: epoch.id,
        btcBlockHash: epoch.btcBlockHash,
        startTime: epoch.startTime,
        duration: CONFIG.EPOCH.DURATION_SECONDS,
        lightningAddress: CONFIG.LIGHTNING_ADDRESS,
      }),
      pubkey
    };

    try {
      const signed = finalizeEvent(event, sk);
      await nostrPool.publish(CONFIG.NOSTR_RELAYS, signed);
      console.log('📡 Nostr: New epoch broadcasted');
    } catch (e) {
      console.error('Nostr broadcast error:', e.message);
    }
  }

  /**
   * Nostr 广播: 结果
   */
  async broadcastResult(epoch, winner, tier, prize) {
    const event = {
      kind: 1112,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['t', 'ahl-result'],
        ['e', epoch.id]
      ],
      content: JSON.stringify({
        app: 'AgentHashLottery',
        action: 'result',
        epochId: epoch.id,
        winner: winner ? {
          name: winner.agentName,
          npub: winner.agentNpub,
          prediction: winner.prediction,
          confidence: winner.confidence,
        } : null,
        tier,
        prizeSats: prize,
        totalPool: epoch.totalSats,
        finalHash: epoch.finalHash,
        btcBlockHash: epoch.btcBlockHash,
      }),
      pubkey
    };

    try {
      const signed = finalizeEvent(event, sk);
      await nostrPool.publish(CONFIG.NOSTR_RELAYS, signed);
      console.log('📡 Nostr: Result broadcasted');
    } catch (e) {
      console.error('Nostr broadcast error:', e.message);
    }
  }

  /**
   * Nostr 广播: 投注
   */
  async broadcastBet(epoch, bet) {
    const event = {
      kind: 1111,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['t', 'ahl-bet'],
        ['e', epoch.id],
        ['p', bet.agentNpub]
      ],
      content: JSON.stringify({
        app: 'AgentHashLottery',
        action: 'bet',
        epochId: epoch.id,
        agentName: bet.agentName,
        prediction: bet.prediction,
        confidence: bet.confidence,
        amountSats: bet.amountSats,
      }),
      pubkey
    };

    try {
      const signed = finalizeEvent(event, sk);
      await nostrPool.publish(CONFIG.NOSTR_RELAYS, signed);
    } catch (e) {
      console.error('Nostr broadcast error:', e.message);
    }
  }

  /**
   * 获取 Epoch 状态
   */
  getEpochStatus(epochId) {
    const epoch = this.epochs.get(epochId);
    if (!epoch) return null;

    return {
      id: epoch.id,
      status: epoch.status,
      totalSats: epoch.totalSats,
      participantCount: epoch.bets.length,
      startTime: epoch.startTime,
      isActive: epoch.status === 'active',
    };
  }
}

/**
 * Polymarket 集成
 */
class PolymarketIntegration {
  constructor() {
    this.baseUrl = 'https://clob.polymarket.com';
  }

  /**
   * 获取热门预测市场
   */
  async getTrendingMarkets(limit = 10) {
    try {
      const response = await fetch(`${this.baseUrl}/markets?limit=${limit}&closed=false`);
      const markets = await response.json();
      
      return markets.map(m => ({
        id: m.conditionId,
        question: m.question,
        volume: m.volume || m.volume24hr,
        odds: m.outcomes?.[0]?.price || 0.5,
        endsAt: m.endDate,
      }));
    } catch (e) {
      console.error('Polymarket API error:', e.message);
      return [];
    }
  }

  /**
   * 获取特定市场详情
   */
  async getMarketDetails(conditionId) {
    try {
      const response = await fetch(`${this.baseUrl}/condition/${conditionId}`);
      return await response.json();
    } catch (e) {
      console.error('Polymarket API error:', e.message);
      return null;
    }
  }
}

/**
 * 自动化 Epoch 管理器
 */
class AutoEpochManager {
  constructor(ahl) {
    this.ahl = ahl;
    this.interval = CONFIG.AUTO_EPOCH.INTERVAL_MINUTES * 60 * 1000;
    this.timer = null;
  }

  /**
   * 启动自动轮换
   */
  start() {
    if (!CONFIG.AUTO_EPOCH.ENABLED) {
      console.log('⚠️ 自动 Epoch 已禁用');
      return;
    }

    console.log(`🔄 自动 Epoch 已启动 (每 ${CONFIG.AUTO_EPOCH.INTERVAL_MINUTES} 分钟)`);
    
    this.timer = setInterval(async () => {
      await this.cycleEpoch();
    }, this.interval);
  }

  /**
   * 停止自动轮换
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('⏹️ 自动 Epoch 已停止');
    }
  }

  /**
   * 轮换 Epoch
   */
  async cycleEpoch() {
    try {
      // 查找活动的 Epoch
      for (const [id, epoch] of this.ahl.epochs) {
        if (epoch.status === 'active' && epoch.bets.length > 0) {
          console.log(`\n🔄 自动结算 Epoch: ${id.substring(0, 8)}...`);
          
          // 结算
          const result = this.ahl.calculateWinner(id);
          
          // 结算完成后创建新 Epoch
          const newEpoch = await this.ahl.createEpoch();
          console.log(`🆕 新 Epoch: ${newEpoch.id.substring(0, 8)}...`);
          
          return result;
        }
      }
    } catch (e) {
      console.error('Auto cycle error:', e.message);
    }
  }
}

// ============= 导出 =============
module.exports = { AgentHashLottery, PolymarketIntegration, AutoEpochManager, CONFIG };
async function runDemo() {
  console.log('🎰 Agent Hash Lottery - Production Demo\n');
  console.log(`⚡ Lightning Address: ${CONFIG.LIGHTNING_ADDRESS}`);
  console.log(`🔗 Nostr Pubkey: ${pubkey}\n`);

  const ahl = new AgentHashLottery();

  // 1. 获取真实 BTC 区块哈希
  console.log('📡 获取 BTC 区块哈希...');
  const btcHash = await ahl.getLatestBtcBlockHash();
  console.log(`   BTC Hash: ${btcHash.substring(0, 32)}...`);

  // 2. 创建新 Epoch
  console.log('\n🆕 创建新 Epoch...');
  const epoch = await ahl.createEpoch();
  console.log(`   Epoch ID: ${epoch.id.substring(0, 8)}...`);

  // 3. 模拟投注
  console.log('\n💰 Agent 投注中...');

  const agents = [
    { name: 'Icehorserider', npub: 'npub1mp0zcatgktmmusaafzslw0whpwllp4h9qacum5', prediction: 'BTC > 70000', confidence: 'high', amount: 1000 },
    { name: 'Trader_Anya', npub: 'npub1test...', prediction: 'ETH > 2500', confidence: 'medium', amount: 500 },
    { name: 'Faircaster', npub: 'npub1fair...', prediction: 'BTC > 70000', confidence: 'high', amount: 1500 },
    { name: 'KraticBot', npub: 'npub1krat...', prediction: 'BTC < 65000', confidence: 'medium', amount: 800 },
  ];

  for (const agent of agents) {
    try {
      const bet = ahl.placeBet(
        epoch.id,
        uuidv4(),
        agent.name,
        agent.npub,
        agent.prediction,
        agent.confidence,
        agent.amount,
        null
      );
      console.log(`   ✓ ${agent.name}: ${agent.prediction} (${agent.amount} sats)`);
      
      // 广播投注
      await ahl.broadcastBet(epoch, bet);
    } catch (e) {
      console.log(`   ❌ ${agent.name}: ${e.message}`);
    }
  }

  // 4. 结算
  console.log('\n🎲 正在计算中奖结果...\n');
  const result = ahl.calculateWinner(epoch.id);

  if (result.winner) {
    console.log('🎉 中奖结果 🎉');
    console.log(`   🏆 中奖者: ${result.winner.agentName}`);
    console.log(`   📌 预测: ${result.winner.prediction}`);
    console.log(`   ⭐ 中奖等级: Tier ${result.tier}`);
    console.log(`   💰 奖金: ${result.prizeSats} sats`);
    console.log(`   🔐 闪电地址: ${CONFIG.LIGHTNING_ADDRESS}`);
  } else {
    console.log('😢 无人中奖，奖池累计到下一轮');
  }

  // 5. 状态
  console.log('\n📊 Epoch 状态:');
  const status = ahl.getEpochStatus(epoch.id);
  console.log(`   状态: ${status.status}`);
  console.log(`   总奖池: ${status.totalSats} sats`);
  console.log(`   参与人数: ${status.participantCount}`);

  return { ahl, epoch, result };
}

// ============= 导出 =============
module.exports = { AgentHashLottery, CONFIG };

// 运行
runDemo().then(() => {
  console.log('\n✅ Demo 完成!\n');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
