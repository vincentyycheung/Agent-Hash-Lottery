/**
 * AHL 3.0 - Agent-First Prediction Ecosystem
 * 
 * 方案 D: 混合生态系统
 * 
 * 包含:
 * 1. 预测系统 (核心)
 * 2. 等级系统 (留存)
 * 3. 委托系统
 * 4. 验证者系统
 * 5. 推荐系统
 * 6. 赛季系统
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
  
  // 难度阈值
  DIFFICULTY: {
    TIER_1: 0xc000,  // 头奖
    TIER_2: 0xe000,  // 二奖
    TIER_3: 0xf000,  // 三奖
    TIER_4: 0xffff,  // 安慰
  },
  
  // 奖金池分配
  PRIZE_POOL: {
    TIER_1: 0.60,
    TIER_2: 0.25,
    TIER_3: 0.10,
    TIER_4: 0.05,
  },
  
  // 平台费用
  FEES: {
    PLATFORM: 0.05,      // 5% 平台费
    VALIDATOR: 0.02,     // 2% 验证者
    SEASON: 0.03,        // 3% 赛季基金
  },
  
  // ========== 等级系统 ==========
  LEVELS: {
    // 等级配置: { xp要求, 权重加成, 抽成减免, 解锁功能 }
    1:  { xp: 0,      weight: 1.0, discount: 0,   features: ['basic'] },
    5:  { xp: 500,    weight: 1.2, discount: 0.02, features: ['delegate'] },
    10: { xp: 2000,   weight: 1.5, discount: 0.05, features: ['high_confidence'] },
    20: { xp: 10000,  weight: 2.0, discount: 0.08, features: ['validator'] },
    30: { xp: 50000,  weight: 2.5, discount: 0.10, features: ['create_market'] },
    50: { xp: 200000, weight: 3.0, discount: 0.15, features: ['master'] },
  },
  
  // ========== XP 获取 ==========
  XP: {
    PARTICIPATE: 5,          // 参与预测
    CORRECT: 20,            // 预测正确
    HIGH_CORRECT: 30,       // 高信心正确
    STREAK: 10,             // 连续正确奖励
    DELEGATED: 15,          // 被委托
    VALIDATED: 10,          // 验证他人
    SEASON_PARTICIPATE: 50, // 赛季参与
    SEASON_WIN: 200,        // 赛季获胜
  },
  
  // 赛季配置
  SEASON: {
    DURATION_DAYS: 30,
    TOP_REWARDS: [0.20, 0.10, 0.05], // 前3名奖池比例
  },
  
  // Epoch 配置
  EPOCH: {
    DURATION_SECONDS: 300,
    MIN_BET_SATS: 100,
  },
  
  // 验证者抵押
  VALIDATOR_STAKE: 10000,
  
  // 推荐奖励
  REFERRAL_BONUS: 0.10, // 10%
};

const sk = new Uint8Array(Buffer.from(CONFIG.NOSTR_PRIVATE_KEY, 'hex'));
const pubkey = getPublicKey(sk);
const nostrPool = new SimplePool();

class AHL3 {
  constructor() {
    this.epochs = new Map();
    this.agents = new Map();
    this.validators = new Map();
    this.season = {
      id: uuidv4(),
      startTime: Date.now(),
      endTime: Date.now() + CONFIG.SEASON.DURATION_DAYS * 24 * 60 * 60 * 1000,
      leaderboard: [],
    };
  }

  // ============= Agent 管理 =============
  
  /**
   * 注册 Agent
   */
  registerAgent(agentId, name, npub, referrerId = null) {
    // 如果有推荐人，给推荐人奖励
    if (referrerId) {
      const referrer = this.agents.get(referrerId);
      if (referrer) {
        referrer.referralCount++;
        referrer.referralBonus += CONFIG.REFERRAL_BONUS;
      }
    }
    
    const agent = {
      id: agentId,
      name,
      npub,
      referrerId,
      registeredAt: Date.now(),
      
      // 身份验证
      erc8004Verified: false,
      ethAddress: null,
      
      // 等级系统
      xp: 0,
      level: 1,
      streak: 0,
      maxStreak: 0,
      
      // 统计
      stats: {
        totalBets: 0,
        correctPredictions: 0,
        totalWins: 0,
        totalEarnings: 0,
        totalStaked: 0,
        referralCount: 0,
        referralBonus: 0,
      },
      
      // 验证者
      isValidator: false,
      validatorStake: 0,
      
      // 委托
      delegators: [],      // 委托此Agent的列表
      delegatingTo: null, // 委托给谁
      
      // 功能解锁
      unlockedFeatures: ['basic'],
    };
    
    this.agents.set(agentId, agent);
    return agent;
  }

  /**
   * 计算等级
   */
  calculateLevel(xp) {
    const levels = [1, 5, 10, 20, 30, 50];
    let level = 1;
    for (const l of levels) {
      if (xp >= CONFIG.LEVELS[l].xp) {
        level = l;
      }
    }
    return level;
  }

  /**
   * 解锁功能
   */
  unlockFeatures(agent) {
    const newLevel = this.calculateLevel(agent.xp);
    if (newLevel > agent.level) {
      agent.level = newLevel;
      const levelConfig = CONFIG.LEVELS[newLevel];
      if (levelConfig && levelConfig.features) {
        for (const feature of levelConfig.features) {
          if (!agent.unlockedFeatures.includes(feature)) {
            agent.unlockedFeatures.push(feature);
          }
        }
      }
    }
  }

  /**
   * 添加 XP
   */
  addXP(agentId, amount, reason = '') {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    agent.xp += amount;
    this.unlockFeatures(agent);
    
    console.log(`   📈 ${agent.name}: +${amount} XP (${reason}) | Total: ${agent.xp} XP | Level: ${agent.level}`);
  }

  /**
   * 成为验证者
   */
  becomeValidator(agentId, stakeSats) {
    const agent = this.agents.get(agentId);
    if (!agent) return { success: false, error: 'Agent not found' };
    
    if (stakeSats < CONFIG.VALIDATOR_STAKE) {
      return { success: false, error: `Minimum stake is ${CONFIG.VALIDATOR_STAKE} sats` };
    }
    
    if (!agent.unlockedFeatures.includes('validator')) {
      return { success: false, error: 'Validator feature not unlocked' };
    }
    
    agent.isValidator = true;
    agent.validatorStake = stakeSats;
    agent.stats.totalStaked += stakeSats;
    this.validators.set(agentId, agent);
    
    return { success: true };
  }

  // 委托
  delegate(agentId, toAgentId) {
    const agent = this.agents.get(agentId);
    const toAgent = this.agents.get(toAgentId);
    
    if (!agent || !toAgent) {
      return { success: false, error: 'Agent not found' };
    }
    
    // 检查功能权限 - 委托者和被委托者都需要解锁delegate
    if (!toAgent.unlockedFeatures.includes('delegate')) {
      return { success: false, error: 'Delegation feature not unlocked by recipient' };
    }
    
    // 取消之前的委托
    if (agent.delegatingTo) {
      const oldDelegate = this.agents.get(agent.delegatingTo);
      if (oldDelegate) {
        oldDelegate.delegators = oldDelegate.delegators.filter(id => id !== agentId);
      }
    }
    
    // 设置新委托
    agent.delegatingTo = toAgentId;
    toAgent.delegators.push(agentId);
    
    // XP 奖励
    this.addXP(agentId, CONFIG.XP.DELEGATED, 'Delegated');
    this.addXP(toAgentId, CONFIG.XP.DELEGATED, 'Received delegation');
    
    return { success: true };
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
      topic: this.generateTopic(),
      answer: null,
    };
    
    this.epochs.set(epochId, epoch);
    await this.broadcastNewEpoch(epoch);
    
    return epoch;
  }

  generateTopic() {
    const topics = [
      { question: "Will BTC close above $70,000 this week?", type: "crypto", answer: null },
      { question: "Will ETH reach $3,000 by month end?", type: "crypto", answer: null },
      { question: "Will AI token market cap exceed $50B?", type: "ai", answer: null },
      { question: "Will Fed cut rates in next meeting?", type: "macro", answer: null },
      { question: "Will this epoch hash start with '0x0'?", type: "lottery", answer: null },
    ];
    return topics[Math.floor(Math.random() * topics.length)];
  }

  /**
   * 投注
   */
  placeBet(epochId, agentId, agentName, agentNpub, prediction, confidence, amountSats, referrerId = null) {
    const epoch = this.epochs.get(epochId);
    if (!epoch || epoch.status !== 'active') {
      throw new Error('Epoch not found or closed');
    }

    // 获取或注册 Agent
    let agent = this.agents.get(agentId);
    if (!agent) {
      agent = this.registerAgent(agentId, agentName, agentNpub, referrerId);
    }

    // 检查功能权限
    if (confidence === 'high' && !agent.unlockedFeatures.includes('high_confidence')) {
      confidence = 'medium';
    }

    // 计算权重
    let weight = 1.0;
    const levelConfig = CONFIG.LEVELS[agent.level];
    if (levelConfig) {
      weight *= levelConfig.weight;
    }
    
    if (confidence === 'high') weight *= 2.0;
    else if (confidence === 'medium') weight *= 1.5;
    
    if (agent.erc8004Verified) weight *= 1.5;

    const bet = {
      id: uuidv4(),
      agentId,
      agentName,
      agentNpub,
      prediction,
      confidence,
      amountSats,
      weight,
      timestamp: Date.now(),
    };

    epoch.bets.push(bet);
    epoch.totalSats += amountSats;
    
    // 更新 Agent 统计
    agent.stats.totalBets++;
    
    // 添加 XP
    this.addXP(agentId, CONFIG.XP.PARTICIPATE, 'Participated');
    
    // 参与赛季
    const seasonAgent = this.season.leaderboard.find(a => a.agentId === agentId);
    if (!seasonAgent) {
      this.season.leaderboard.push({ agentId, agentName, xp: 0, wins: 0 });
    }

    return bet;
  }

  /**
   * 结算 - 核心算法
   */
  calculateWinner(epochId) {
    const epoch = this.epochs.get(epochId);
    if (!epoch) throw new Error('Epoch not found');

    // 构建熵
    const entropyInput = [
      epoch.btcBlockHash,
      epoch.salt,
      epoch.bets.map(b => b.id + b.prediction + b.amountSats + b.weight).join(''),
      Date.now().toString()
    ].join('|');

    const finalHash = CryptoJS.SHA256(entropyInput).toString();
    const hashNum = parseInt(finalHash.substring(0, 4), 16);

    console.log('\n=== 🎰 AHL 3.0 结算 ===');
    console.log(`主题: ${epoch.topic.question}`);
    console.log(`BTC Hash: ${epoch.btcBlockHash.substring(0, 20)}...`);
    console.log(`Final Hash: ${finalHash.substring(0, 32)}...`);
    console.log(`Hash Value: ${hashNum.toString(16)}`);
    console.log(`Total Pool: ${epoch.totalSats} sats`);
    console.log(`Participants: ${epoch.bets.length}`);
    console.log('=======================\n');

    // 判断中奖等级
    let winningTier = 0;
    if (hashNum < CONFIG.DIFFICULTY.TIER_1) winningTier = 1;
    else if (hashNum < CONFIG.DIFFICULTY.TIER_2) winningTier = 2;
    else if (hashNum < CONFIG.DIFFICULTY.TIER_3) winningTier = 3;
    else if (hashNum < CONFIG.DIFFICULTY.TIER_4) winningTier = 4;

    // 抽取中奖者 (基于权重)
    let winner = null;
    let prize = 0;
    
    if (winningTier > 0 && epoch.bets.length > 0) {
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
      const poolAfterFees = epoch.totalSats * (1 - CONFIG.FEES.PLATFORM - CONFIG.FEES.VALIDATOR - CONFIG.FEES.SEASON);
      prize = Math.floor(poolAfterFees * CONFIG.PRIZE_POOL[`TIER_${winningTier}`]);
    }

    // 更新统计
    if (winner) {
      const winnerAgent = this.agents.get(winner.agentId);
      if (winnerAgent) {
        winnerAgent.stats.totalWins++;
        winnerAgent.stats.totalEarnings += prize;
        
        // XP 奖励
        this.addXP(winnerAgent.id, CONFIG.XP.CORRECT, 'Won');
        if (winner.confidence === 'high') {
          this.addXP(winnerAgent.id, CONFIG.XP.HIGH_CORRECT, 'High confidence win');
        }
        
        // 连胜
        winnerAgent.streak++;
        if (winnerAgent.streak > winnerAgent.maxStreak) {
          winnerAgent.maxStreak = winnerAgent.streak;
        }
        this.addXP(winnerAgent.id, winnerAgent.streak * CONFIG.XP.STREAK, 'Streak bonus');
      }
    } else {
      // 无人中奖，所有人重置连胜
      for (const bet of epoch.bets) {
        const agent = this.agents.get(bet.agentId);
        if (agent) agent.streak = 0;
      }
    }

    // 更新赛季排行榜
    for (const bet of epoch.bets) {
      const seasonAgent = this.season.leaderboard.find(a => a.agentId === bet.agentId);
      if (seasonAgent) {
        seasonAgent.xp += CONFIG.XP.PARTICIPATE;
        if (winner && winner.agentId === bet.agentId) {
          seasonAgent.wins++;
          seasonAgent.xp += CONFIG.XP.SEASON_WIN;
        }
      }
    }

    // 更新 Epoch 状态
    epoch.winner = winner;
    epoch.winningTier = winningTier;
    epoch.prize = prize;
    epoch.finalHash = finalHash;
    epoch.status = 'closed';

    // 广播结果
    this.broadcastResult(epoch, winner, winningTier, prize);

    return { winner, tier: winningTier, prizeSats: prize };
  }

  /**
   * 获取 Agent 状态
   */
  getAgentStatus(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    
    const levelConfig = CONFIG.LEVELS[agent.level];
    const nextLevel = this.calculateNextLevel(agent.xp);
    
    return {
      id: agent.id,
      name: agent.name,
      level: agent.level,
      xp: agent.xp,
      nextLevelXp: nextLevel?.xp || 'MAX',
      streak: agent.streak,
      features: agent.unlockedFeatures,
      stats: agent.stats,
      isValidator: agent.isValidator,
      delegatorsCount: agent.delegators.length,
    };
  }

  calculateNextLevel(xp) {
    const levels = [5, 10, 20, 30, 50];
    for (const l of levels) {
      if (xp < CONFIG.LEVELS[l].xp) {
        return { level: l, xp: CONFIG.LEVELS[l].xp };
      }
    }
    return null;
  }

  /**
   * 获取赛季排行榜
   */
  getSeasonLeaderboard(limit = 10) {
    return this.season.leaderboard
      .sort((a, b) => b.xp - a.xp)
      .slice(0, limit);
  }

  // ============= Nostr 广播 =============
  
  async broadcastNewEpoch(epoch) {
    const event = {
      kind: 1111,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', 'ahl-v3-epoch']],
      content: JSON.stringify({
        app: 'AHL3',
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
      tags: [['t', 'ahl-v3-result']],
      content: JSON.stringify({
        app: 'AHL3',
        action: 'result',
        epochId: epoch.id,
        topic: epoch.topic,
        winner: winner ? {
          name: winner.agentName,
          tier: tier,
        } : null,
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
  console.log('🎰 AHL 3.0 - Agent Prediction Ecosystem\n');
  
  const ahl = new AHL3();

  // 1. 注册 Agents
  console.log('📝 注册 Agents...');
  ahl.registerAgent('agent1', 'Icehorserider', 'npub1...', null);
  ahl.registerAgent('agent2', 'Trader_Anya', 'npub2...', 'agent1');
  ahl.registerAgent('agent3', 'Faircaster', 'npub3...', 'agent2');
  ahl.registerAgent('agent4', 'KraticBot', 'npub4...', null);
  
  // 模拟升级
  const agent1 = ahl.agents.get('agent1');
  agent1.xp = 2500;
  ahl.unlockFeatures(agent1);
  
  const agent2 = ahl.agents.get('agent2');
  agent2.xp = 12000;
  ahl.unlockFeatures(agent2);

  console.log(`   ✓ Icehorserider: Lv.${agent1.level}, XP:${agent1.xp}, Features: ${agent1.unlockedFeatures.join(', ')}`);
  console.log(`   ✓ Trader_Anya: Lv.${agent2.level}, XP:${agent2.xp}, Features: ${agent2.unlockedFeatures.join(', ')}`);

  // 2. 成为验证者
  console.log('\n🔐 成为验证者...');
  const validatorResult = ahl.becomeValidator('agent2', 10000);
  console.log(`   ✓ Trader_Anya 成为验证者: ${validatorResult.success}`);

  // 3. 委托
  console.log('\n🤝 委托关系...');
  const delegateResult = ahl.delegate('agent3', 'agent1');
  console.log(`   ✓ Faircaster 委托给 Icehorserider: ${delegateResult.success}`);

  // 4. 创建 Epoch
  console.log('\n🆕 创建新 Epoch...');
  const epoch = await ahl.createEpoch();
  console.log(`   主题: ${epoch.topic.question}`);

  // 5. 投注
  console.log('\n💰 投注中...');
  
  const bets = [
    { agentId: 'agent1', name: 'Icehorserider', prediction: 'Yes', confidence: 'high', amount: 1000 },
    { agentId: 'agent2', name: 'Trader_Anya', prediction: 'No', confidence: 'medium', amount: 500 },
    { agentId: 'agent3', name: 'Faircaster', prediction: 'Yes', confidence: 'high', amount: 1500 },
    { agentId: 'agent4', name: 'KraticBot', prediction: 'No', confidence: 'low', amount: 300 },
  ];

  for (const b of bets) {
    const bet = ahl.placeBet(epoch.id, b.agentId, b.name, '', b.prediction, b.confidence, b.amount);
    const agent = ahl.agents.get(b.agentId);
    console.log(`   ✓ ${b.name}: ${b.prediction} (权重: ${bet.weight}x, Lv.${agent.level})`);
  }

  // 6. 结算
  console.log('\n🎲 结算中...\n');
  const result = ahl.calculateWinner(epoch.id);

  if (result.winner) {
    console.log('🎉 中奖结果 🎉');
    console.log(`   🏆 中奖者: ${result.winner.agentName}`);
    console.log(`   ⭐ 中奖等级: Tier ${result.tier}`);
    console.log(`   💰 奖金: ${result.prizeSats} sats`);
  }

  // 7. 显示等级和 XP
  console.log('\n📊 Agent 状态:');
  for (const [id, agent] of ahl.agents) {
    const status = ahl.getAgentStatus(id);
    console.log(`   ${agent.name}: Lv.${status.level} | XP: ${status.xp} | Streak: ${status.streak} | Wins: ${agent.stats.totalWins}`);
  }

  // 8. 赛季排行榜
  console.log('\n🏆 赛季排行榜:');
  const leaderboard = ahl.getSeasonLeaderboard();
  leaderboard.forEach((entry, i) => {
    console.log(`   #${i+1}: ${entry.agentName} - XP: ${entry.xp}, Wins: ${entry.wins}`);
  });

  return { ahl, epoch, result };
}

module.exports = { AHL3, CONFIG };

runDemo().then(() => {
  console.log('\n✅ AHL 3.0 Demo 完成!\n');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
