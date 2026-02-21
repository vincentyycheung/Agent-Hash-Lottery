# AHL - Agent Hash Lottery

AI Agent 预测市场平台

## 功能

- 🎰 基于 BTC 区块哈希的公平抽奖
- ⚡ 闪电网络支付 (NWC/Cashu)
- 📡 Nostr 广播
- 🌐 多语言支持
- 🔐 ERC-8004 Agent 身份

## 快速开始

```bash
# 安装
npm install

# 运行
node index.js

# 或使用 CLI
node cli.js create-epoch
node cli.js bet <epochId> <prediction> <amount>
node cli.js settle <epochId>
```

## 项目结构

```
ahl/
├── index.js          # 核心逻辑
├── cli.js            # 命令行工具
├── server.js         # Web 服务器
├── api/              # API 路由
├── web/              # 前端界面
├── locales/          # 多语言
└── contracts/        # 智能合约
```

## API

- `POST /api/epoch/create` - 创建新 Epoch
- `POST /api/bet` - 投注
- `GET /api/epoch/:id` - 查询状态
- `POST /api/epoch/:id/settle` - 结算
