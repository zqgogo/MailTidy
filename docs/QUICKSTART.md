# MailTidy 快速开始指南

## 项目概述

MailTidy 是一个 AI 驱动的邮件整理代理，能够自动学习用户偏好并智能整理邮件。

## 当前进度

### Phase 1-2: 核心功能 ✅
- 启发式邮件分类引擎
- 偏好学习系统
- 决策历史追踪

### Phase 3: 研究与感知 ✅
- 3.1-3.3: 研究规划器与钓鱼检测
- 3.4: 研究反馈整合
- 3.5: 钓鱼回归测试 (21个测试用例)
- 3.6: 代理自我感知

### Phase 4: 邮件连接器 ✅
- Gmail 连接器 (OAuth 2.0)
- Outlook 连接器 (Microsoft Graph API)
- 跨平台部署方案

### Phase 5: 运维工具 ✅
- CLI 命令行工具
- 运行时监控与告警
- 结构化日志系统
- 审计日志与数据管理

---

## 快速启动

### 1. 安装依赖

```bash
cd MailTidy
npm install
```

### 2. 构建项目

```bash
npm run build
```

### 3. 初始化配置

```bash
# 初始化 MailTidy 环境
node dist/cli.js init

# 或使用 npx
npx mailtidy init
```

### 4. 运行清理任务（模拟模式）

```bash
# 模拟运行，不实际修改邮件
node dist/cli.js run-cleanup --dry-run

# 实际运行
node dist/cli.js run-cleanup
```

---

## CLI 命令

| 命令 | 说明 |
|------|------|
| `run-cleanup` | 运行邮件清理任务 |
| `status` | 显示代理状态和自我评估报告 |
| `health-check` | 健康检查 |
| `config --init` | 初始化配置文件 |
| `config --show` | 显示当前配置 |
| `config --set key=value` | 设置配置项 |
| `init` | 初始化 MailTidy 环境 |
| `reset --confirm` | 重置代理状态 |

---

## 测试验证

### 1. 运行单元测试

```bash
# 运行所有测试
npm test

# 运行钓鱼检测测试
npm test -- --testPathPattern=phishing

# 运行学习引擎测试
npm test -- --testPathPattern=learning
```

### 2. 健康检查

```bash
node dist/cli.js health-check
```

预期输出示例：
```
Health Status: good
Total Decisions: 100
Accuracy: 85.0%
Total Preferences: 50
Tool Error Rate: 2.5%
```

### 3. 查看状态报告

```bash
node dist/cli.js status
```

### 4. 验证日志系统

```bash
# 查看日志目录
ls -la .mailtidy/logs/

# 查看审计日志
cat .mailtidy/audit.log
```

---

## 开发测试

### TypeScript 类型检查

```bash
npm run build
```

### Lint 检查

```bash
npm run lint
```

### 覆盖测试

```bash
npm test -- --coverage
```

---

## 核心模块测试

### 钓鱼检测测试

```bash
npx vitest run tests/phishing-regression.test.ts
```

测试覆盖：
- FTX 风格攻击
- 钓鱼域名检测
- 账户验证诈骗
- 紧急行动模式
- 凭证收割攻击
- 组合攻击向量

### 学习引擎测试

```bash
npx vitest run tests/learning.test.ts
```

测试覆盖：
- 信号处理
- 偏好更新
- 权重调整
- 历史记录

### 代理循环测试

```bash
npx vitest run tests/agent-loop.test.ts
```

---

## 部署验证

### 本地部署 (macOS)

```bash
# 生成 launchd 配置
node dist/cli.js deploy --platform=darwin --output=~/Library/LaunchAgents/
```

### Docker 部署

```bash
# 构建镜像
docker build -t mailtidy .

# 运行容器
docker run -v $(pwd)/.mailtidy:/app/.mailtidy mailtidy
```

### GitHub Actions

```bash
# 触发定时清理
gh workflow run cleanup.yml
```

---

## 目录结构

```
MailTidy/
├── src/
│   ├── agent/          # 代理核心
│   │   ├── loop.ts     # 代理循环
│   │   ├── planner.ts  # 规划器
│   │   └── self-awareness.ts  # 自我感知
│   ├── data/          # 数据层
│   │   ├── memory.ts   # 记忆管理
│   │   └── learning.ts # 学习引擎
│   ├── integrations/  # 集成
│   │   └── email/      # 邮件连接器
│   │       ├── gmail.ts
│   │       └── outlook.ts
│   ├── ops/           # 运维工具
│   │   ├── config.ts   # 配置管理
│   │   ├── deploy.ts   # 部署管理
│   │   ├── monitor.ts  # 监控告警
│   │   ├── logger.ts   # 日志系统
│   │   └── audit.ts    # 审计日志
│   └── cli.ts         # CLI 工具
├── tests/            # 测试文件
│   ├── phishing-regression.test.ts
│   └── learning.test.ts
└── docs/             # 文档
    └── agent-design.md
```

---

## 状态目录

运行时生成的文件存储在 `.mailtidy/` 目录：

```
.mailtidy/
├── preferences.json    # 用户偏好
├── history.json        # 操作历史
├── audit.log          # 审计日志
├── metrics.json       # 性能指标
└── logs/
    ├── mailtidy.log   # 应用日志
    └── alerts.log     # 告警日志
```

---

## 下一步

1. 配置邮件提供商（Gmail/Outlook）
2. 设置 OAuth 认证
3. 运行真实邮件清理
4. 查看性能报告

详细配置请参考 [docs/agent-design.md](docs/agent-design.md)
