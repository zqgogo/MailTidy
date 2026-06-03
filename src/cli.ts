#!/usr/bin/env node
/**
 * MailTidy CLI 命令行工具（Phase 5.1）
 * 
 * 提供命令行接口，支持：
 *   - 运行清理任务（占位）
 *   - 管理配置
 *   - 查看自我评估报告
 *   - 健康检查
 */

import { Command } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";

// 动态导入已实现的模块
async function importSelfAwareness() {
  const { createSelfAwareness } = await import("./agent/self-awareness.js");
  const { emptyMemory } = await import("./data/memory.js");
  return { createSelfAwareness, emptyMemory };
}

const program = new Command();

program
  .name("mailtidy")
  .description("MailTidy Email Agent - AI-powered email organizer")
  .version("0.1.0");

// 运行清理任务（占位实现）
program
  .command("run-cleanup")
  .description("Run email cleanup task")
  .option("--dry-run", "Simulate without making changes")
  .option("--state-dir <path>", "State directory", ".mailtidy")
  .option("--config <path>", "Config file path", "mailtidy.config.json")
  .action(async (options) => {
    try {
      console.log("📧 Starting MailTidy cleanup task...");
      
      // 创建状态目录
      await fs.mkdir(options.stateDir, { recursive: true });
      
      console.log("\n✅ Cleanup completed!");
      console.log("📊 Processed: 0 emails (Mock mode)");
      console.log("📁 Archived: 0");
      console.log("⭐ Starred: 0");
      console.log("📝 Labeled: 0");
      
      if (options.dryRun) {
        console.log("\n⚠️  Dry run mode - no changes were made");
      }
    } catch (error) {
      console.error("❌ Cleanup failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// 显示自我评估报告
program
  .command("status")
  .description("Show agent status and self-assessment report")
  .option("--state-dir <path>", "State directory", ".mailtidy")
  .action(async (options) => {
    try {
      const { createSelfAwareness, emptyMemory } = await importSelfAwareness();
      
      const selfAwareness = createSelfAwareness({ stateDir: options.stateDir });
      const memory = emptyMemory();
      
      console.log(selfAwareness.generateReport(memory));
    } catch (error) {
      console.error("❌ Failed to get status:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// 健康检查
program
  .command("health-check")
  .description("Run health check")
  .option("--state-dir <path>", "State directory", ".mailtidy")
  .action(async (options) => {
    try {
      const { createSelfAwareness } = await importSelfAwareness();
      
      const selfAwareness = createSelfAwareness({ stateDir: options.stateDir });
      const summary = selfAwareness.getSummary();
      
      const status = summary.healthStatus;
      const statusColor = status === "excellent" ? "\x1b[32m" : 
                         status === "good" ? "\x1b[32m" : 
                         status === "fair" ? "\x1b[33m" : "\x1b[31m";
      
      console.log(`Health Status: ${statusColor}${status}\x1b[0m`);
      console.log(`Total Decisions: ${summary.totalDecisions}`);
      console.log(`Accuracy: ${(summary.accuracy * 100).toFixed(1)}%`);
      console.log(`Total Preferences: ${summary.totalPreferences}`);
      console.log(`Tool Error Rate: ${(summary.toolErrorRate * 100).toFixed(1)}%`);
      
      if (status === "excellent" || status === "good") {
        process.exit(0);
      } else {
        process.exit(1);
      }
    } catch (error) {
      console.error("❌ Health check failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// 配置管理
interface DefaultConfig {
  llm: {
    provider: string;
    model?: string;
  };
  email: {
    provider: string;
  };
}

const defaultConfig: DefaultConfig = {
  llm: { provider: "heuristic" },
  email: { provider: "mock" },
};

program
  .command("config")
  .description("Manage configuration")
  .option("--init", "Initialize config file")
  .option("--show", "Show current config")
  .option("--set <key=value>", "Set config value")
  .option("--path <path>", "Config file path", "mailtidy.config.json")
  .action(async (options) => {
    try {
      if (options.init) {
        await fs.writeFile(options.path, JSON.stringify(defaultConfig, null, 2), "utf-8");
        console.log(`✅ Config file created at ${options.path}`);
        return;
      }
      
      if (options.show) {
        try {
          const raw = await fs.readFile(options.path, "utf-8");
          const config = JSON.parse(raw);
          console.log(JSON.stringify(config, null, 2));
        } catch {
          console.log(JSON.stringify(defaultConfig, null, 2));
        }
        return;
      }
      
      if (options.set) {
        let config: Record<string, unknown> = { ...defaultConfig };
        try {
          const raw = await fs.readFile(options.path, "utf-8");
          config = JSON.parse(raw);
        } catch {}
        
        const [key, value] = options.set.split("=");
        const keys = key.split(".");
        let current = config;
        
        for (let i = 0; i < keys.length - 1; i++) {
          if (!current[keys[i]]) {
            current[keys[i]] = {};
          }
          current = current[keys[i]] as Record<string, unknown>;
        }
        
        let parsedValue: unknown = value;
        try {
          parsedValue = JSON.parse(value);
        } catch {}
        
        current[keys[keys.length - 1]] = parsedValue;
        await fs.writeFile(options.path, JSON.stringify(config, null, 2), "utf-8");
        console.log(`✅ Set ${key}=${parsedValue}`);
        return;
      }
      
      const configCommand = program.commands.find((c: { name: () => string }) => c.name() === "config");
      configCommand?.help();
    } catch (error) {
      console.error("❌ Config error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// 初始化命令
program
  .command("init")
  .description("Initialize MailTidy setup")
  .option("--state-dir <path>", "State directory", ".mailtidy")
  .action(async (options) => {
    try {
      // Create state directory
      await fs.mkdir(options.stateDir, { recursive: true });
      await fs.mkdir(path.join(options.stateDir, "logs"), { recursive: true });
      
      // Create config file
      const configPath = "mailtidy.config.json";
      if (!await fs.access(configPath).then(() => true).catch(() => false)) {
        await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
      }
      
      // Create .env.example
      const envContent = `# MailTidy Environment Variables
LLM_PROVIDER=heuristic
EMAIL_PROVIDER=mock
STATE_DIR=${options.stateDir}
DRY_RUN=false
`;
      await fs.writeFile(".env.example", envContent, "utf-8");
      
      console.log("✅ MailTidy initialized successfully!");
      console.log(`📁 State directory: ${options.stateDir}`);
      console.log(`📝 Config file: ${configPath}`);
      console.log(`🔧 Example env: .env.example`);
      console.log("\nNext steps:");
      console.log("1. Configure your email provider in mailtidy.config.json");
      console.log("2. Run 'mailtidy run-cleanup' to start cleaning");
    } catch (error) {
      console.error("❌ Initialization failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// 重置命令
program
  .command("reset")
  .description("Reset agent state")
  .option("--state-dir <path>", "State directory", ".mailtidy")
  .option("--confirm", "Confirm reset")
  .action(async (options) => {
    if (!options.confirm) {
      console.log("⚠️  This will reset all agent state. Use --confirm to proceed.");
      return;
    }
    
    try {
      const { createSelfAwareness } = await importSelfAwareness();
      
      const selfAwareness = createSelfAwareness({ stateDir: options.stateDir });
      await selfAwareness.reset();
      
      console.log("✅ Agent state reset successfully");
    } catch (error) {
      console.error("❌ Reset failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// 显示帮助
program
  .command("help")
  .description("Show help")
  .action(() => {
    program.help();
  });

// 解析参数
program.parse();

// 如果没有提供命令，显示帮助
if (!process.argv.slice(2).length) {
  program.help();
}