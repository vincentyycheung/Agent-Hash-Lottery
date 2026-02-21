/**
 * AHL CLI 工具
 * 
 * 使用方法:
 *   node cli.js create-epoch
 *   node cli.js bet <prediction> <amount> [confidence]
 *   node cli.js settle
 *   node cli.js status
 */

const { AgentHashLottery, CONFIG } = require('./index.js');

const ahl = new AgentHashLottery();
let currentEpoch = null;

const commands = {
  // 创建新 Epoch
  'create-epoch': async () => {
    console.log('🆕 创建新 Epoch...');
    currentEpoch = await ahl.createEpoch();
    console.log(`   Epoch ID: ${currentEpoch.id}`);
    console.log(`   BTC Hash: ${currentEpoch.btcBlockHash.substring(0, 32)}...`);
    console.log('✅ 成功!');
  },
  
  // 投注
  'bet': async (args) => {
    if (!currentEpoch) {
      // 尝试获取当前 epoch
      console.log('📡 尝试连接服务器...');
    }
    
    const prediction = args[0];
    const amount = parseInt(args[1]) || 100;
    const confidence = args[2] || 'medium';
    
    console.log(`💰 投注: ${prediction} (${amount} sats, ${confidence})`);
    
    try {
      const bet = ahl.placeBet(
        currentEpoch.id,
        Date.now().toString(),
        'Icehorserider',
        CONFIG.NOSTR_PRIVATE_KEY.substring(0, 20) + '...',
        prediction,
        confidence,
        amount
      );
      
      await ahl.broadcastBet(currentEpoch, bet);
      console.log('✅ 投注成功!');
    } catch (e) {
      console.log('❌ 投注失败:', e.message);
    }
  },
  
  // 结算
  'settle': async () => {
    if (!currentEpoch) {
      console.log('❌ 没有活动的 Epoch');
      return;
    }
    
    console.log('🎲 结算中...');
    const result = ahl.calculateWinner(currentEpoch.id);
    
    if (result.winner) {
      console.log(`\n🎉 中奖!`);
      console.log(`   中奖者: ${result.winner.agentName}`);
      console.log(`   预测: ${result.winner.prediction}`);
      console.log(`   等级: Tier ${result.tier}`);
      console.log(`   奖金: ${result.prizeSats} sats`);
      console.log(`   闪电地址: ${CONFIG.LIGHTNING_ADDRESS}`);
    } else {
      console.log('😢 无人中奖');
    }
    
    // 创建新 epoch
    console.log('\n🆕 创建新 Epoch...');
    currentEpoch = await ahl.createEpoch();
    console.log(`   新 Epoch ID: ${currentEpoch.id}`);
  },
  
  // 状态
  'status': async () => {
    if (!currentEpoch) {
      console.log('❌ 没有活动的 Epoch');
      return;
    }
    
    console.log('\n📊 当前 Epoch 状态');
    console.log(`   ID: ${currentEpoch.id}`);
    console.log(`   状态: ${currentEpoch.status}`);
    console.log(`   奖池: ${currentEpoch.totalSats} sats`);
    console.log(`   参与人数: ${currentEpoch.bets.length}`);
    console.log(`   BTC Hash: ${currentEpoch.btcBlockHash.substring(0, 32)}...`);
    
    if (currentEpoch.bets.length > 0) {
      console.log('\n💰 投注列表:');
      currentEpoch.bets.forEach((bet, i) => {
        console.log(`   ${i+1}. ${bet.agentName}: ${bet.prediction} (${bet.amountSats} sats, ${bet.confidence})`);
      });
    }
  },
  
  // BTC Hash
  'btc': async () => {
    const hash = await ahl.getLatestBtcBlockHash();
    console.log(`🔗 最新 BTC 区块哈希:\n   ${hash}`);
  },
  
  // 帮助
  'help': () => {
    console.log(`
🎰 AHL CLI

用法: node cli.js <command> [args]

命令:
  create-epoch     创建新 Epoch
  bet <pred> <amt> [conf]  投注
  settle           结算当前 Epoch
  status           查看当前状态
  btc              获取 BTC 区块哈希
  help             显示帮助

示例:
  node cli.js create-epoch
  node cli.js bet "BTC>70000" 500 high
  node cli.js settle
  node cli.js status
`);
  }
};

// 运行
const cmd = process.argv[2];
const args = process.argv.slice(3);

if (commands[cmd]) {
  commands[cmd](args);
} else {
  console.log(`未知命令: ${cmd}`);
  commands.help();
}
