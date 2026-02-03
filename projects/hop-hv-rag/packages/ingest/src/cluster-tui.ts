import {
  BoxRenderable,
  TextRenderable,
  TextAttributes,
  createCliRenderer,
  type CliRenderer,
} from '@opentui/core';

interface CompletedBatch {
  batchNum: number;
  totalBatches: number;
  title: string | null;
  durationMs: number;
  timestamp: number;
  hadError: boolean;
  errorType?: 'ai-parse' | 'api' | 'unknown';
  errorMessage?: string;
}

interface ActivityLine {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  timestamp: number;
}

interface SummaryStats {
  totalBatches: number;
  completedBatches: number;
  totalItems: number;
  processedItems: number;
  errors: Array<{ batchNum: number; error: string }>;
  warnings: Array<{ batchNum: number; message: string }>;
  failedBatches: Array<{
    batchNum: number;
    totalBatches: number;
    errorType: 'ai-parse' | 'api' | 'unknown';
    errorMessage: string;
  }>;
}

export class ClusterTUI {
  private renderer: CliRenderer | null = null;
  private startTime = 0;
  private recentActivity: ActivityLine[] = [];
  private inFlightBatches = 0;
  private maxConcurrency = 0;
  private totalBatches = 0;
  private completedBatchCount = 0;
  private totalItems = 0;
  private processedItems = 0;
  private readonly maxActivityLines = 10;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private headerLabel = 'Clustering';

  private headerText: TextRenderable | null = null;
  private progressText: TextRenderable | null = null;
  private statsText: TextRenderable | null = null;
  private throughputText: TextRenderable | null = null;
  private poolText: TextRenderable | null = null;
  private activityLines: TextRenderable[] = [];
  private errorBox: BoxRenderable | null = null;
  private errorText: TextRenderable | null = null;
  private rootBox: BoxRenderable | null = null;

  async start(
    totalBatches: number,
    totalItems: number,
    maxConcurrency: number,
    headerLabel?: string,
  ): Promise<void> {
    this.totalBatches = totalBatches;
    this.totalItems = totalItems;
    this.maxConcurrency = maxConcurrency;
    this.startTime = Date.now();
    if (headerLabel) this.headerLabel = headerLabel;

    this.renderer = await createCliRenderer({
      exitOnCtrlC: true,
    });

    this.buildUI();
    this.renderer.start();
  }

  stop(): void {
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }

    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
  }

  updateProgress(completedBatches: number, processedItems: number): void {
    this.completedBatchCount = completedBatches;
    this.processedItems = processedItems;

    const percent =
      this.totalBatches > 0
        ? Math.round((completedBatches / this.totalBatches) * 100)
        : 0;

    if (this.progressText) {
      this.progressText.content = this.formatProgressBar(percent);
    }

    if (this.statsText) {
      this.statsText.content = this.formatStats();
    }

    if (this.throughputText) {
      this.throughputText.content = this.formatThroughput();
    }
  }

  setInFlightCount(count: number): void {
    this.inFlightBatches = count;
    if (this.poolText) {
      this.poolText.content = this.formatPool();
    }
  }

  recordBatchComplete(batch: CompletedBatch): void {
    const title = batch.title ? ` "${this.truncate(batch.title, 28)}"` : '';
    const duration =
      batch.durationMs < 1000
        ? `${batch.durationMs}ms`
        : `${(batch.durationMs / 1000).toFixed(1)}s`;
    const message = batch.hadError
      ? `Batch ${batch.batchNum}/${batch.totalBatches} (${duration})`
      : `Batch ${batch.batchNum}/${batch.totalBatches}${title} (${duration})`;

    let activityType: ActivityLine['type'] = 'success';
    if (batch.hadError) {
      activityType = batch.errorType === 'ai-parse' ? 'warning' : 'error';
    }

    this.addActivity(activityType, message);
  }

  addActivity(type: ActivityLine['type'], message: string): void {
    this.recentActivity.push({ type, message, timestamp: Date.now() });
    if (this.recentActivity.length > this.maxActivityLines) {
      this.recentActivity.shift();
    }
    this.updateActivityDisplay();
  }

  showError(message: string, durationMs: number = 10000): void {
    if (this.errorText) {
      this.errorText.content = `❌ ${message}`;
    }
    if (this.errorBox) {
      this.errorBox.visible = true;
    }

    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
    }

    this.errorTimer = setTimeout(() => {
      if (this.errorBox) {
        this.errorBox.visible = false;
      }
    }, durationMs);
  }

  showShutdownMessage(message: string): void {
    if (this.headerText) {
      this.headerText.content = `⚠️ ${message}`;
      this.headerText.fg = '#f59e0b';
    }
  }

  finalize(stats: SummaryStats): void {
    this.stop();

    const elapsedMs = Date.now() - this.startTime;
    const elapsedText = this.formatDuration(elapsedMs / 1000);
    const avgRate =
      elapsedMs > 0
        ? (stats.completedBatches / (elapsedMs / 1000)).toFixed(1)
        : '0.0';

    console.log('');
    console.log(
      '┌─────────────────────────────────────────────────────────────────┐',
    );
    console.log(
      '│ 🏁 COMPLETE                                                      │',
    );
    console.log(
      '├─────────────────────────────────────────────────────────────────┤',
    );
    console.log(`│ ${`Total Time: ${elapsedText}`.padEnd(65)}│`);
    console.log(`│ ${`Avg Rate: ${avgRate} batches/sec`.padEnd(65)}│`);
    console.log(
      `│ ${`Total Batches: ${stats.completedBatches}/${stats.totalBatches}`.padEnd(65)}│`,
    );
    console.log(
      `│ ${`Total Items: ${stats.processedItems}/${stats.totalItems}`.padEnd(65)}│`,
    );

    if (stats.errors.length > 0) {
      console.log(
        '├─────────────────────────────────────────────────────────────────┤',
      );
      console.log(`│ ${`Errors: ${stats.errors.length}`.padEnd(65)}│`);
      console.log(
        '├─────────────────────────────────────────────────────────────────┤',
      );
      console.log(
        '│ ERROR DETAILS:                                                   │',
      );
      for (const err of stats.errors.slice(0, 5)) {
        const line = `• Batch ${err.batchNum}: ${this.truncate(err.error, 50)}`;
        console.log(`│ ${line.padEnd(65)}│`);
      }
      if (stats.errors.length > 5) {
        const moreLine = `... and ${stats.errors.length - 5} more`;
        console.log(`│ ${moreLine.padEnd(65)}│`);
      }
    }

    if (stats.failedBatches.length > 0) {
      console.log(
        '├─────────────────────────────────────────────────────────────────┤',
      );
      const failedHeader = `FAILED BATCHES: ${stats.failedBatches.length}`;
      console.log(`│ ${failedHeader.padEnd(65)}│`);
      for (const batch of stats.failedBatches.slice(0, 5)) {
        const icon = batch.errorType === 'ai-parse' ? '⚠️' : '❌';
        const errorLabel =
          batch.errorType === 'ai-parse'
            ? 'AI'
            : batch.errorType === 'api'
              ? 'API'
              : 'ERR';
        const line = `• ${icon} batch ${batch.batchNum}/${batch.totalBatches} (${errorLabel})`;
        console.log(`│ ${line.padEnd(65)}│`);
      }
      if (stats.failedBatches.length > 5) {
        const moreLine = `... and ${stats.failedBatches.length - 5} more`;
        console.log(`│ ${moreLine.padEnd(65)}│`);
      }
    }

    if (stats.warnings.length > 0) {
      console.log(
        '├─────────────────────────────────────────────────────────────────┤',
      );
      console.log(
        '│ WARNINGS:                                                        │',
      );
      for (const warn of stats.warnings.slice(0, 3)) {
        const line = `• Batch ${warn.batchNum}: ${this.truncate(warn.message, 52)}`;
        console.log(`│ ${line.padEnd(65)}│`);
      }
    }

    console.log(
      '└─────────────────────────────────────────────────────────────────┘',
    );
  }

  private buildUI(): void {
    if (!this.renderer) return;

    const root = new BoxRenderable(this.renderer, {
      flexDirection: 'column',
      padding: 1,
      gap: 1,
      width: this.renderer.width,
      height: this.renderer.height,
    });
    this.rootBox = root;

    this.renderer.on('resize', (width, height) => {
      if (this.rootBox) {
        this.rootBox.width = width;
        this.rootBox.height = height;
      }
    });

    const headerBox = new BoxRenderable(this.renderer, {
      border: true,
      borderStyle: 'rounded',
      borderColor: '#3b82f6',
      padding: 1,
      flexDirection: 'column',
      gap: 1,
    });

    this.headerText = new TextRenderable(this.renderer, {
      content: this.headerLabel,
      fg: '#3b82f6',
      attributes: TextAttributes.BOLD,
    });

    this.progressText = new TextRenderable(this.renderer, {
      content: this.formatProgressBar(0),
      fg: '#9ca3af',
    });

    headerBox.add(this.headerText);
    headerBox.add(this.progressText);
    root.add(headerBox);

    const statsBox = new BoxRenderable(this.renderer, {
      border: true,
      borderStyle: 'single',
      borderColor: '#6b7280',
      padding: 1,
      flexDirection: 'column',
      gap: 0,
    });

    this.statsText = new TextRenderable(this.renderer, {
      content: this.formatStats(),
      fg: '#d1d5db',
    });

    this.throughputText = new TextRenderable(this.renderer, {
      content: 'Starting...',
      fg: '#9ca3af',
    });

    this.poolText = new TextRenderable(this.renderer, {
      content: this.formatPool(),
      fg: '#cbd5f5',
    });

    statsBox.add(this.statsText);
    statsBox.add(this.throughputText);
    statsBox.add(this.poolText);
    root.add(statsBox);

    const activityBox = new BoxRenderable(this.renderer, {
      border: true,
      borderStyle: 'single',
      borderColor: '#374151',
      padding: 1,
      flexDirection: 'column',
      gap: 0,
      flexGrow: 1,
    });

    const activityHeader = new TextRenderable(this.renderer, {
      content: 'Activity Log',
      fg: '#9ca3af',
      attributes: TextAttributes.BOLD,
    });
    activityBox.add(activityHeader);

    for (let i = 0; i < this.maxActivityLines; i++) {
      const line = new TextRenderable(this.renderer, {
        content: '',
        fg: '#4b5563',
      });
      this.activityLines.push(line);
      activityBox.add(line);
    }

    root.add(activityBox);

    this.errorBox = new BoxRenderable(this.renderer, {
      border: true,
      borderStyle: 'rounded',
      borderColor: '#ef4444',
      backgroundColor: '#3f1d1d',
      padding: 1,
      flexDirection: 'column',
    });
    this.errorBox.visible = false;

    this.errorText = new TextRenderable(this.renderer, {
      content: '',
      fg: '#fecaca',
    });
    this.errorBox.add(this.errorText);
    root.add(this.errorBox);

    this.renderer.root.add(root);
  }

  private updateActivityDisplay(): void {
    for (let i = 0; i < this.maxActivityLines; i++) {
      const line = this.activityLines[i];
      const activity = this.recentActivity[i];

      if (activity) {
        const icon =
          activity.type === 'success'
            ? '✅'
            : activity.type === 'error'
              ? '❌'
              : activity.type === 'warning'
                ? '⚠️'
                : 'ℹ️';

        const color =
          activity.type === 'success'
            ? '#22c55e'
            : activity.type === 'error'
              ? '#ef4444'
              : activity.type === 'warning'
                ? '#f59e0b'
                : '#3b82f6';

        line.content = `${icon} ${activity.message}`;
        line.fg = color;
      } else {
        line.content = '';
        line.fg = '#4b5563';
      }
    }
  }

  private formatProgressBar(percent: number): string {
    const barWidth = 30;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    return `[${bar}] ${percent.toString().padStart(3)}%`;
  }

  private formatStats(): string {
    return `${this.completedBatchCount}/${this.totalBatches} batches • ${this.processedItems}/${this.totalItems} items`;
  }

  private formatThroughput(): string {
    const elapsedMs = Date.now() - this.startTime;
    if (elapsedMs === 0 || this.completedBatchCount === 0) {
      return 'Starting...';
    }

    const rate = this.completedBatchCount / (elapsedMs / 1000);
    const remaining = this.totalBatches - this.completedBatchCount;
    const etaSeconds = remaining > 0 ? remaining / rate : 0;

    return `${rate.toFixed(1)} batches/sec • ETA: ${this.formatDuration(etaSeconds)}`;
  }

  private formatPool(): string {
    const activeSlots = Math.min(this.inFlightBatches, this.maxConcurrency);
    const poolWidth = Math.min(this.maxConcurrency, 20);
    const activeVisual = Math.round(
      (activeSlots / this.maxConcurrency) * poolWidth,
    );
    const poolBar =
      '▶'.repeat(activeVisual) + '░'.repeat(poolWidth - activeVisual);
    const queueDepth =
      this.totalBatches - this.completedBatchCount - this.inFlightBatches;

    return `Pool: [${poolBar}] ${this.inFlightBatches}/${this.maxConcurrency} active • ${queueDepth} queued`;
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600)
      return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }

  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
  }
}
