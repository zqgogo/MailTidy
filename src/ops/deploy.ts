/**
 * 本地部署脚本
 * 
 * Phase 4.4 实现：
 *   - macOS: launchd 配置
 *   - Linux: systemd 服务和 cron 任务
 *   - Windows: Task Scheduler (PowerShell)
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export interface DeploymentConfig {
  projectDir: string;
  stateDir?: string;
  schedule?: "hourly" | "daily" | "weekly";
  time?: string; // e.g., "09:00"
  dayOfWeek?: number; // 0-6 for weekly
}

export interface DeploymentResult {
  success: boolean;
  message: string;
  commands?: string[];
}

/**
 * 生成 macOS launchd 配置
 */
export function generateLaunchdConfig(config: DeploymentConfig): string {
  const label = "com.mailtidy.agent";
  const schedule = config.schedule ?? "daily";
  const time = config.time ?? "09:00";
  
  const hourStr = time.split(":")[0] ?? "9";
  const minuteStr = time.split(":")[1] ?? "0";
  const hour = parseInt(hourStr);
  const minute = parseInt(minuteStr);

  const startCalendarInterval: Record<string, number> = { Hour: hour, Minute: minute };

  if (schedule === "weekly" && config.dayOfWeek !== undefined) {
    startCalendarInterval.Weekday = config.dayOfWeek;
  }

  const stateDir = config.stateDir ?? config.projectDir;
  const programArguments = ["node", "dist/index.js", "run-cleanup"];
  if (config.stateDir) {
    programArguments.push("--state-dir", config.stateDir);
  }

  const weekDayPart = startCalendarInterval.Weekday !== undefined 
    ? `\n        <key>Weekday</key>\n        <integer>${startCalendarInterval.Weekday}</integer>` 
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${programArguments[0]}</string>
        <string>${programArguments[1]}</string>
        <string>${programArguments[2]}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${config.projectDir}</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>${startCalendarInterval.Hour}</integer>
        <key>Minute</key>
        <integer>${startCalendarInterval.Minute}</integer>${weekDayPart}
    </dict>
    <key>StandardOutPath</key>
    <string>${stateDir}/logs/mailtidy.log</string>
    <key>StandardErrorPath</key>
    <string>${stateDir}/logs/mailtidy.error.log</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>`;
}

/**
 * 生成 Linux systemd 服务配置
 */
export function generateSystemdService(config: DeploymentConfig): string {
  const serviceName = "mailtidy.service";

  return `[Unit]
Description=MailTidy Email Agent
After=network.target

[Service]
Type=oneshot
WorkingDirectory=${config.projectDir}
ExecStart=${config.projectDir}/node_modules/.bin/ts-node src/index.ts run-cleanup --state-dir ${config.stateDir ?? config.projectDir}
StandardOutput=append:${config.stateDir ?? config.projectDir}/logs/mailtidy.log
StandardError=append:${config.stateDir ?? config.projectDir}/logs/mailtidy.error.log
User=${process.env.USER ?? "root"}

[Install]
WantedBy=multi-user.target`;
}

/**
 * 生成 Linux cron 配置
 */
export function generateCronConfig(config: DeploymentConfig): string {
  const schedule = config.schedule ?? "daily";
  const time = config.time ?? "09:00";
  
  let cronTime: string;
  switch (schedule) {
    case "hourly":
      cronTime = "0 * * * *";
      break;
    case "weekly":
      const dayOfWeek = config.dayOfWeek ?? 0;
      cronTime = `${time.split(":")[1]} ${time.split(":")[0]} * * ${dayOfWeek}`;
      break;
    case "daily":
    default:
      cronTime = `${time.split(":")[1]} ${time.split(":")[0]} * * *`;
      break;
  }

  const stateDir = config.stateDir ?? config.projectDir;

  return `# MailTidy Email Agent Cron Job
# Schedule: ${schedule}
${cronTime} cd ${config.projectDir} && ${config.projectDir}/node_modules/.bin/ts-node src/index.ts run-cleanup --state-dir ${stateDir} >> ${stateDir}/logs/mailtidy.log 2>> ${stateDir}/logs/mailtidy.error.log`;
}

/**
 * 生成 Windows Task Scheduler PowerShell 脚本
 */
export function generateWindowsTaskScript(config: DeploymentConfig): string {
  const schedule = config.schedule ?? "daily";
  const time = config.time ?? "09:00";
  
  let frequency: string;
  let modifier = "";
  switch (schedule) {
    case "hourly":
      frequency = "HOURLY";
      break;
    case "weekly":
      frequency = "WEEKLY";
      modifier = `/D ${getWindowsDayOfWeek(config.dayOfWeek ?? 0)}`;
      break;
    case "daily":
    default:
      frequency = "DAILY";
      break;
  }

  const stateDir = config.stateDir ?? config.projectDir;
  const projectDir = config.projectDir.replace(/\\/g, "\\\\");

  return `# MailTidy Email Agent - Windows Task Scheduler Setup
# Run this script as Administrator

$taskName = "MailTidy"
$action = New-ScheduledTaskAction -Execute "node" -Argument "dist\\\\index.js run-cleanup --state-dir \\"$stateDir\\"" -WorkingDirectory "$projectDir"
$trigger = New-ScheduledTaskTrigger -${frequency} -At "${time}" ${modifier}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

# Remove existing task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Register new task
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "MailTidy Email Agent Cleanup Task"

Write-Host "MailTidy scheduled task created successfully!"
`;

  function getWindowsDayOfWeek(day: number): string {
    const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    return days[day] ?? "SUN";
  }
}

/**
 * 生成 Docker 配置
 */
export function generateDockerfile(projectDir: string, baseImage: string = "node:20-alpine"): string {
  return `# MailTidy Email Agent - Docker Configuration
FROM ${baseImage}

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code and build
COPY . .
RUN npm run build

# Create state directory
RUN mkdir -p /app/.mailtidy/logs

# Set environment variables
ENV NODE_ENV=production
ENV STATE_DIR=/app/.mailtidy

# Default command
CMD ["node", "dist/index.js", "run-cleanup"]

# Health check
HEALTHCHECK --interval=1h --timeout=30s --start-period=10s --retries=3 \\
  CMD node dist/index.js health-check || exit 1`;
}

/**
 * 生成 Docker Compose 配置
 */
export function generateDockerCompose(): string {
  return `version: '3.8'

services:
  mailtidy:
    build: .
    container_name: mailtidy-agent
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - STATE_DIR=/app/.mailtidy
    volumes:
      - ./data:/app/.mailtidy
      - ./logs:/app/.mailtidy/logs
    env_file:
      - .env
    healthcheck:
      test: ["CMD", "node", "dist/index.js", "health-check"]
      interval: 1h
      timeout: 30s
      retries: 3

  # Optional: Watchtower for auto-updates
  watchtower:
    image: containrrr/watchtower
    container_name: mailtidy-watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 86400 mailtidy-agent
    profiles:
      - auto-update`;
}

/**
 * 生成 GitHub Actions workflow
 */
export function generateGitHubActionsWorkflow(): string {
  return `name: MailTidy Scheduled Cleanup

on:
  schedule:
    # Run daily at 9 AM UTC
    - cron: '0 9 * * *'
  workflow_dispatch:
    # Manual trigger

jobs:
  cleanup:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Run cleanup
        env:
          STATE_DIR: \${{ github.workspace }}/.mailtidy
          # Add your API keys as secrets
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
        run: node dist/index.js run-cleanup --state-dir "\$STATE_DIR"

      - name: Upload logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mailtidy-logs
          path: .mailtidy/logs/*.log
          retention-days: 7`;
}

/**
 * 生成环境变量示例文件
 */
export function generateEnvExample(): string {
  return `# MailTidy Environment Variables
# Copy this file to .env and fill in your values

# LLM Configuration
LLM_PROVIDER=openai
OPENAI_API_KEY=your-api-key-here
# ANTHROPIC_API_KEY=your-anthropic-key-here

# Email Provider
EMAIL_PROVIDER=gmail
# For Gmail
GMAIL_CREDENTIALS_PATH=.mailtidy/credentials.json
GMAIL_TOKEN_PATH=.mailtidy/token.json

# For Outlook
# OUTLOOK_CLIENT_ID=your-client-id
# OUTLOOK_CLIENT_SECRET=your-client-secret

# Agent Configuration
STATE_DIR=.mailtidy
DRY_RUN=false
AUTO_CONFIRM_THRESHOLD=3

# Logging
LOG_LEVEL=info
`;
}

/**
 * 部署管理器
 */
export class DeploymentManager {
  private readonly projectDir: string;
  private readonly stateDir: string;

  constructor(projectDir: string, stateDir?: string) {
    this.projectDir = projectDir;
    this.stateDir = stateDir ?? path.join(projectDir, ".mailtidy");
  }

  async setupLogsDirectory(): Promise<void> {
    const logsDir = path.join(this.stateDir, "logs");
    await fs.mkdir(logsDir, { recursive: true });
  }

  async deployMacOS(config: DeploymentConfig): Promise<DeploymentResult> {
    try {
      await this.setupLogsDirectory();
      
      const plistContent = generateLaunchdConfig(config);
      const plistPath = path.join(this.stateDir, "com.mailtidy.agent.plist");
      await fs.writeFile(plistPath, plistContent, "utf-8");

      return {
        success: true,
        message: `Launchd plist saved to ${plistPath}`,
        commands: [
          `mkdir -p ~/Library/LaunchAgents`,
          `cp ${plistPath} ~/Library/LaunchAgents/`,
          `launchctl load ~/Library/LaunchAgents/com.mailtidy.agent.plist`,
        ],
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to deploy on macOS: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  async deployLinux(config: DeploymentConfig): Promise<DeploymentResult> {
    try {
      await this.setupLogsDirectory();
      
      // Generate systemd service
      const serviceContent = generateSystemdService(config);
      const servicePath = path.join(this.stateDir, "mailtidy.service");
      await fs.writeFile(servicePath, serviceContent, "utf-8");

      // Generate cron
      const cronContent = generateCronConfig(config);
      const cronPath = path.join(this.stateDir, "mailtidy-cron");

      return {
        success: true,
        message: "Deployment files generated",
        commands: [
          `# Install systemd service:`,
          `sudo cp ${servicePath} /etc/systemd/system/`,
          `sudo systemctl daemon-reload`,
          `sudo systemctl enable mailtidy.service`,
          ``,
          `# OR install cron job:`,
          `crontab -e # and paste the content from ${cronPath}`,
        ],
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to deploy on Linux: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  async deployDocker(): Promise<DeploymentResult> {
    try {
      const dockerfile = generateDockerfile(this.projectDir);
      const compose = generateDockerCompose();

      await fs.writeFile(path.join(this.projectDir, "Dockerfile"), dockerfile, "utf-8");
      await fs.writeFile(path.join(this.projectDir, "docker-compose.yml"), compose, "utf-8");

      return {
        success: true,
        message: "Docker files generated",
        commands: [
          `docker-compose up -d`,
          `# With auto-update:`,
          `docker-compose --profile auto-update up -d`,
        ],
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate Docker files: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  async deployGitHubActions(): Promise<DeploymentResult> {
    try {
      const workflow = generateGitHubActionsWorkflow();
      const workflowDir = path.join(this.projectDir, ".github", "workflows");
      
      await fs.mkdir(workflowDir, { recursive: true });
      await fs.writeFile(path.join(workflowDir, "mailtidy.yml"), workflow, "utf-8");

      return {
        success: true,
        message: "GitHub Actions workflow generated at .github/workflows/mailtidy.yml",
        commands: [
          `# Add secrets to GitHub:`,
          `# Settings -> Secrets -> Actions -> New repository secret`,
          `# Add OPENAI_API_KEY`,
        ],
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate GitHub Actions: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  async generateEnvFile(): Promise<DeploymentResult> {
    try {
      const envExample = generateEnvExample();
      const envPath = path.join(this.projectDir, ".env.example");
      await fs.writeFile(envPath, envExample, "utf-8");

      return {
        success: true,
        message: `Environment example generated at ${envPath}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate .env.example: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }
}

export function createDeploymentManager(projectDir: string, stateDir?: string): DeploymentManager {
  return new DeploymentManager(projectDir, stateDir);
}