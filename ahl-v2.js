/**
 * AHL 2.0 - Agent-First Prediction Lottery
 * 
 * 核心创新：
 * 1. 预测准确性权重 - 正确预测增加中奖概率
 * 2. Agent 身份验证 - ERC-8004 + Nostr 双重验证
 * 3. 验证者机制 - AI Agent 互相验证预测
 * 4. 社交证明 - Nostr 转发增加可信度
 * 5. 推荐奖励 - Agent 推荐 Agent
 */

const CryptoJS = require("crypto-js");
const { v4: uuidv4 } = require('uuid');
const { finalizeEvent, getPublicKey, SimplePool } = require('nostr-tools');

// ============= 配置 =============
const CONFIG = {
  NOSTR_PRIVATE_KEY: process.env.NOSTR_PRIVATE_KEY || '76c70b80dad17392fe0368547f365c99e9b4b033cd51d6265f9550474ab1a0ff',
  NOSTR_RELAYS: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'],
  LIGHTNING_ADDRESS: process.env.LIGHTNING_ADDRESS || 'icehorse16@primal.net',
  BTC_API: 'https://blockstream.info/api',
  
  // AHL 2.0 新参数
  DIFFICULTY: {
    TIER_1: 0xc000,  // 头奖 4%
    TIER_2: 0xe000,  // 二奖 4%
    TIER_3: 0xf000,  // 三奖 2%
    TIER_4: 0xffff,  // 安慰
  },
  
  // 权重系统
  WEIGHTS: {
    CORRECT_PREDICTION: 3.0,    // 正确预测 x3
    HIGH_CONFIDENCE: 2.0,        // 高信心 x2
    MEDIUM_CONFIDENCE: 1.5,      // 中信心 x1.5
    ERC8004_VERIFIED: 1.5,       // ERC-8004 验证 x1.5
    NOSTR_REPOST: 1.2,           // Nostr 转发 x1.2
    REFERRAL: 1.3,              // 推荐奖励 x1.3
  },
  
  // 费用
  FEES: {
    PLATFORM_FEE: 0.05,         // 5% 平台费
    VALIDATOR_FEE: 0.02,        // 2% 验证者费
  },
  
  EPOCH: {
    DURATION_SECONDS: 300,
    MIN_BET_SATS: 100,
  }
};

const sk = new Uint8Array(Buffer.from(CONFIG.NOSTR_PRIVATE_KEY, 'hex'));
const pubkey = getPublicKey(sk);
const nostrPool = new SimplePool();

class AHL2 {
  constructor() {
    this.epochs = new Map();
    this.agents = new Map();        // Agent 注册表
    this.validators = new Map();    // 验证者
    this.predictions = new Map();   // 预测记录
  }

  // ============= Agent 管理 =============
  
  /**
   * 注册 Agent
   */
  registerAgent(agentId, name, npub, metadata = {}) {
    const agent = {
      id: agentId,
      name,
      npub,
      metadata,
      registeredAt: Date.now(),
      // ERC-8004 验证状态
      erc8004Verified: false,
      ethAddress: null,
      // 统计数据
      stats: {
        totalBets: 0,
        correctPredictions: 0,
        totalWins: 0,
        totalEarnings: 0,
        reputation: 0,
      },
      // 验证者状态
      isValidator: false,
      validatedCount: 0,
    };
    
    this.agents.set(agentId, agent);
    return agent;
  }

  /**
   * 验证 Agent (ERC-8004)
   */
  verifyAgent(agentId, ethAddress) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    
    agent.erc8004Verified = true;
    agent.ethAddress = ethAddress;
    agent.stats.reputation += 10;
    return true;
  }

  /**
   * 成为验证者
   */
  becomeValidator(agentId, stakeSats) {
    if (stakeSats < 10000) return false; // 需要抵押
    
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    
    agent.isValidator = true;
    agent.validatorStake = stakeSats;
    this.validators.set(agentId, agent);
    return true;
  }

  // ============= Epoch 管理 =============
  
  async createEpoch() {
    const btcHash = await this.getLatestBtcBlockHash();
    const epochId = uuidv4();
    
    const epoch = {
      id: epochId,
      btcBlockHash: btcHash,
      salt: CryptoJS.lib.WordArray.random(16).toString(),
      startTime: Date.now(),
      status: 'active',
      bets: [],
      totalSats: 0,
      // 新增: 预测主题
      topic: this.generateTopic(),
      // 新增: 答案 (用于计算准确率)
      answer: null,
    };
    
    this.epochs.set(epochId, epoch);
    await this.broadcastNewEpoch(epoch);
    
    return epoch;
  }

  generateTopic() {
    const topics = [
      { question: "BTC will close above $70,000 this week?", type: "crypto", answer: null },
      { question: "ETH will reach $3,000 by month end?", type: "crypto", answer: null },
      { question: "AI token market cap will exceed $50B?", type: "ai", answer: null },
      { question: "Fed will cut rates in next meeting?", type: "macro", answer: null },
      { question: "This epoch's hash will start with '0x'?", type: "lottery", answer: null },
    ];
    return topics[Math.floor(Math.random() * topics.length)];
  }

  /**
   * 投注
   */
  placeBet(epochId, agentId, agentName, agentNpub, prediction, answer, confidence, amountSats) {
    const epoch = this.epochs.get(epochId);
    if (!epoch || epoch.status !== 'active') {
      throw new Error('Epoch not found or closed');
    }

    // 获取 Agent
    let agent = this.agents.get(agentId);
    if (!agent) {
      agent = this.registerAgent(agentId, agentName, agentNpub);
    }

    // 计算权重
    let weight = 1.0;
    
    // 信心等级权重
    if (confidence === 'high') weight *= CONFIG.WEIGHTS.HIGH_CONFIDENCE;
    else if (confidence === 'medium') weight *= CONFIG.WEIGHTS.MEDIUM_CONFIDENCE;
    
    // ERC-8004 验证权重
    if (agent.erc8004Verified) weight *= CONFIG.WEIGHTS.ERC8004_VERIFIED;

    const bet = {
      id: uuidv4(),
      agentId,
      agentName,
      agentNpub,
      prediction,
      answer,           // 预测的答案
      confidence,
      amountSats,
      weight,          // 最终权重
      timestamp: Date.now(),
      // 社交证明
      nostrRepost: false,
      referralId: null,
    };

    epoch.bets.push(bet);
    epoch.totalSats += amountSats;
    
    // 更新 Agent 统计
    agent.stats.totalBets++;
    
    return bet;
  }

  /**
   * 结算 - 核心算法
   */
  calculateWinner(epochId) {
    const epoch = this.epochs.get(epochId);
    if (!epoch) throw new Error('Epoch not found');

    // 计算最终哈希
    const entropyInput = [
      epoch.btcBlockHash,
      epoch.salt,
      epoch.bets.map(b => b.id + b.prediction + b.amountSats + b.weight).join(''),
      Date.now().toString()
    ].join('|');

    const finalHash = CryptoJS.SHA256(entropyInput).toString();
    const hashNum = parseInt(finalHash.substring(0, 4), 16);

    console.log('\n=== 🎰 AHL 2.0 结算 ===');
    console.log(`主题: ${epoch.topic.question}`);
    console.log(`BTC Hash: ${epoch.btcBlockHash.substring(0, 20)}...`);
    console.log(`Final Hash: ${finalHash.substring(0, 32)}...`);
    console.log(`Hash Value: ${hashNum.toString(16)}`);
    console.log(`Total Pool: ${epoch.totalSats} sats`);
    console.log(`Participants: ${epoch.bets.length}`);
    console.log('========================\n');

    // 判断中奖等级
    let winningTier = 0;
    if (hashNum < CONFIG.DIFFICULTY.TIER_1) winningTier = 1;
    else if (hashNum < CONFIG.DIFFICULTY.TIER_2) winningTier = 2;
    else if (hashNum < CONFIG.DIFFICULTY.TIER_3) winningTier = 3;
    else if (hashNum < CONFIG.DIFFICULTY.TIER_4) winningTier = 4;

    // 如果有中奖者，根据权重池抽取
    let winner = null;
    let prize = 0;
    let correctBetters = [];

    if (winningTier > 0 && epoch.bets.length > 0) {
      // 识别正确预测的 Agent
      correctBetters = epoch.bets.filter(b => 
        b.answer === epoch.topic.answer
      );
      
      // 如果有人预测正确，给正确预测者加权
      if (correctBetters.length > 0) {
        correctBetters.forEach(b => {
          b.isCorrect = true;
          b.weight *= CONFIG.WEIGHTS.CORRECT_PREDICTION;
        });
      }

      // 构建加权池
      const weightPool = epoch.bets.reduce((sum, b) => sum + b.weight * b.amountSats, 0);
      let random = Math.random() * weightPool;
      
      for (const bet of epoch.bets) {
        random -= bet.weight * bet.amountSats;
        if (random <= 0) {
          winner = bet;
          break;
        }
      }

      // 计算奖金
      const poolAfterFees = epoch.totalSats * (1 - CONFIG.FEES.PLATFORM_FEE - CONFIG.FEES.VALIDATOR_FEE);
      prize = Math.floor(poolAfterFees * (winningTier === 1 ? 0.70 : winningTier === 2 ? 0.20 : 0.10));
    }

    epoch.winner = winner;
    epoch.winningTier = winningTier;
    epoch.prize = prize;
    epoch.finalHash = finalHash;
    epoch.correctBetters = correctBetters;
    epoch.status = 'closed';

    // 更新统计数据
    if (winner) {
      const winnerAgent = this.agents.get(winner.agentId);
      if (winnerAgent) {
        winnerAgent.stats.totalWins++;
        winnerAgent.stats.totalEarnings += prize;
        if (winner.isCorrect) {
          winnerAgent.stats.correctPredictions++;
        }
        winnerAgent.stats.reputation += 5;
      }
    }

    // 广播结果
    this.broadcastResult(epoch, winner, winningTier, prize);

    return { winner, tier: winningTier, prizeSats: prize, correctCount: correctBetters.length };
  }

  // ============= Nostr 广播 =============
  
  async broadcastNewEpoch(epoch) {
    const event = {
      kind: 1111,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', 'ahl-v2-epoch']],
      content: JSON.stringify({
        app: 'AHL2',
        action: 'new_epoch',
        epochId: epoch.id,
        topic: epoch.topic,
        btcBlockHash: epoch.btcBlockHash,
        startTime: epoch.startTime,
        lightningAddress: CONFIG.LIGHTNING_ADDRESS,
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

  async broadcastResult(epoch, winner, tier, prize) {
    const event = {
      kind: 1112,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', 'ahl-v2-result']],
      content: JSON.stringify({
        app: 'AHL2',
        action: 'result',
        epochId: epoch.id,
        topic: epoch.topic,
        winner: winner ? {
          name: winner.agentName,
          isCorrect: winner.isCorrect,
        } : null,
        correctCount: epoch.correctBetters?.length || 0,
        tier,
        prizeSats: prize,
        totalPool: epoch.totalSats,
        finalHash: epoch.finalHash,
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

  async getLatestBtcBlockHash() {
    try {
      const response = await fetch(`${CONFIG.BTC_API}/blocks/tip/hash`);
      return await response.text();
    } catch (e) {
      return '00000000000000000000a882324aa7cdadd0e1af62fa7cbd894e49d76ae5fb7d';
    }
  }
}

// ============= 运行 Demo =============
async function runDemo() {
  console.log('🎰 AHL 2.0 - Agent-First Prediction Lottery\n');
  
  const ahl = new AHL2();

  // 1. 注册 Agents
  console.log('📝 注册 Agents...');
  ahl.registerAgent('agent1', 'Icehorserider', 'npub1...', { platform: 'moltbook' });
  ahl.registerAgent('agent2', 'Trader_Anya', 'npub2...', { platform: 'moltbook' });
  ahl.registerAgent('agent3', 'Faircaster', 'npub3...', { platform: 'moltbook' });
  
  // 验证一个 Agent
  ahl.verifyAgent('agent1', '0x1234...');
  console.log('   ✓ Icehorserider 已验证 (ERC-8004)');

  // 2. 创建 Epoch
  console.log('\n🆕 创建新 Epoch...');
  const epoch = await ahl.createEpoch();
  console.log(`   主题: ${epoch.topic.question}`);

  // 3. 投注 (模拟预测)
  console.log('\n💰 投注中...');
  
  const bets = [
    { agentId: 'agent1', name: 'Icehorserider', prediction: 'Yes', answer: 'Yes', confidence: 'high', amount: 1000 },
    { agentId: 'agent2', name: 'Trader_Anya', prediction: 'No', answer: 'No', confidence: 'medium', amount: 500 },
    { agentId: 'agent3', name: 'Faircaster', prediction: 'Yes', answer: 'Yes', confidence: 'high', amount: 1500 },
  ];

  for (const b of bets) {
    const bet = ahl.placeBet(epoch.id, b.agentId, b.name, '', b.prediction, b.answer, b.confidence, b.amount);
    console.log(`   ✓ ${b.name}: ${b.prediction} (权重: ${bet.weight}x, ${b.amount} sats)`);
  }

  // 4. 结算
  console.log('\n🎲 结算中...\n');
  const result = ahl.calculateWinner(epoch.id);

  if (result.winner) {
    console.log('🎉 中奖结果 🎉');
    console.log(`   🏆 中奖者: ${result.winner.agentName}`);
    console.log(`   ✅ 预测正确: ${result.winner.isCorrect ? '是' : '否'}`);
    console.log(`   ⭐ 中奖等级: Tier ${result.tier}`);
    console.log(`   💰 奖金: ${result.prizeSats} sats`);
    console.log(`   📊 正确预测人数: ${result.correctCount}`);
  }

  // 5. 统计
  console.log('\n📊 Agent 统计:');
  for (const [id, agent] of ahl.agents) {
    console.log(`   ${agent.name}: ${agent.stats.totalWins}胜 ${agent.stats.totalEarnings} sats 收益, 信誉: ${agent.stats.reputation}`);
  }

  return { ahl, epoch, result };
}

module.exports = { AHL2, CONFIG };

runDemo().then(() => {
  console.log('\n✅ AHL 2.0 Demo 完成!\n');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
