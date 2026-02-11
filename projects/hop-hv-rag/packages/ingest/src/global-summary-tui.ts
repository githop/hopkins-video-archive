import {
  createCliRenderer,
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  TextAttributes,
} from '@opentui/core';

interface CompletedVideo {
  videoId: number;
  filename: string;
  chunkCount: number;
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
  totalVideos: number;
  completedVideos: number;
  totalChunks: number;
  completedChunks: number;
  errors: Array<{ videoId: number; filename: string; error: string }>;
  warnings: Array<{ videoId: number; filename: string; message: string }>;
  failedVideos: Array<{
    videoId?: number;
    filename: string;
    errorType?: 'ai-parse' | 'api' | 'unknown';
    errorMessage?: string;
  }>;
}

export class GlobalSummaryTUI {
  private renderer: CliRenderer | null = null;
  private startTime = 0;
  private recentActivity: ActivityLine[] = [];
  private inFlightVideos = 0;
  private maxConcurrency = 0;
  private totalVideos = 0;
  private completedVideoCount = 0;
  private totalChunks = 0;
  private completedChunkCount = 0;
  private readonly maxActivityLines = 12;

  private progressText: TextRenderable | null = null;
  private statsText: TextRenderable | null = null;
  private throughputText: TextRenderable | null = null;
  private poolText: TextRenderable | null = null;
  private activityLines: TextRenderable[] = [];

  async start(
    totalVideos: number,
    totalChunks: number,
    maxConcurrency: number,
  ): Promise<void> {
    this.totalVideos = totalVideos;
    this.totalChunks = totalChunks;
    this.maxConcurrency = maxConcurrency;
    this.startTime = Date.now();

    this.renderer = await createCliRenderer({
      exitOnCtrlC: true,
    });

    this.buildUI();
    // Ensure console is hidden and renderer is focused on root
    this.renderer.console.hide();
    this.renderer.start();
  }

  private buildUI() {
    if (!this.renderer) return;

    const root = new BoxRenderable(this.renderer, {
      flexDirection: 'column',
      padding: 1,
      gap: 1,
      width: '100%',
      height: '100%',
    });

    // Header
    const headerBox = new BoxRenderable(this.renderer, {
      border: true,
      borderStyle: 'rounded',
      borderColor: '#3b82f6',
      padding: 1,
      flexDirection: 'column',
      gap: 1,
    });
    headerBox.add(
      new TextRenderable(this.renderer, {
        content: '📚 Global Archivist',
        fg: '#3b82f6',
        attributes: TextAttributes.BOLD,
      }),
    );
    this.progressText = new TextRenderable(this.renderer, {
      content: this.formatProgressBar(0),
      fg: '#9ca3af',
    });
    headerBox.add(this.progressText);
    root.add(headerBox);

    // Stats
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
      height: 1,
    });
    this.throughputText = new TextRenderable(this.renderer, {
      content: 'Starting...',
      fg: '#9ca3af',
      height: 1,
    });
    this.poolText = new TextRenderable(this.renderer, {
      content: this.formatPool(),
      fg: '#cbd5f5',
      height: 1,
    });
    statsBox.add(this.statsText);
    statsBox.add(this.throughputText);
    statsBox.add(this.poolText);
    root.add(statsBox);

    // Activity
    const activityBox = new BoxRenderable(this.renderer, {
      border: true,
      borderStyle: 'single',
      borderColor: '#374151',
      padding: 1,
      flexDirection: 'column',
      flexGrow: 1,
    });
    activityBox.add(
      new TextRenderable(this.renderer, {
        content: 'Activity Log',
        fg: '#9ca3af',
        attributes: TextAttributes.BOLD,
        marginBottom: 1,
      }),
    );

    for (let i = 0; i < this.maxActivityLines; i++) {
      const line = new TextRenderable(this.renderer, {
        content: '',
        fg: '#4b5563',
        height: 1,
      });
      this.activityLines.push(line);
      activityBox.add(line);
    }
    root.add(activityBox);

    this.renderer.root.add(root);
  }

  stop(): void {
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
  }

  updateProgress(completedVideos: number, completedChunks: number): void {
    this.completedVideoCount = completedVideos;
    this.completedChunkCount = completedChunks;
    const percent =
      this.totalVideos > 0
        ? Math.round((completedVideos / this.totalVideos) * 100)
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
    this.inFlightVideos = count;
    if (this.poolText) {
      this.poolText.content = this.formatPool();
    }
  }

  recordVideoComplete(video: CompletedVideo): void {
    const chunks = video.chunkCount > 0 ? ` ${video.chunkCount} chunks` : '';
    const duration =
      video.durationMs < 1000
        ? `${video.durationMs}ms`
        : `${(video.durationMs / 1000).toFixed(1)}s`;
    const message = video.hadError
      ? `${this.truncate(video.filename, 30)} (${duration})`
      : `${this.truncate(video.filename, 30)}${chunks} (${duration})`;

    const type = video.hadError
      ? video.errorType === 'ai-parse'
        ? 'warning'
        : ('error' as const)
      : ('success' as const);

    this.recentActivity.push({ type, message, timestamp: Date.now() });
    if (this.recentActivity.length > this.maxActivityLines) {
      this.recentActivity.shift();
    }
    this.updateActivityDisplay();
  }

  private updateActivityDisplay() {
    for (let i = 0; i < this.maxActivityLines; i++) {
      const line = this.activityLines[i];
      const activity = this.recentActivity[i];
      if (line) {
        if (activity) {
          line.content = `${this.getIcon(activity.type)} ${activity.message}`;
          line.fg = this.getColor(activity.type);
        } else {
          line.content = '';
        }
      }
    }
  }

  private getIcon(type: ActivityLine['type']) {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      default:
        return 'ℹ️';
    }
  }

  private getColor(type: ActivityLine['type']) {
    switch (type) {
      case 'success':
        return '#22c55e';
      case 'error':
        return '#ef4444';
      case 'warning':
        return '#f59e0b';
      default:
        return '#3b82f6';
    }
  }

  finalize(stats: SummaryStats): void {
    this.stop();

    const elapsedMs = Date.now() - this.startTime;
    const elapsedText = this.formatDuration(elapsedMs / 1000);
    const avgRate =
      elapsedMs > 0
        ? (stats.completedVideos / (elapsedMs / 1000)).toFixed(1)
        : '0.0';

    console.log('\n' + '─'.repeat(67));
    console.log('🏁 GLOBAL SUMMARIES COMPLETE');
    console.log('─'.repeat(67));
    console.log(`Total Time:   ${elapsedText}`);
    console.log(`Avg Rate:     ${avgRate} videos/sec`);
    console.log(`Total Videos: ${stats.completedVideos}/${stats.totalVideos}`);
    console.log(`Total Chunks: ${stats.completedChunks}/${stats.totalChunks}`);

    if (stats.failedVideos.length > 0) {
      console.log('\nFAILED VIDEOS:');
      for (const video of stats.failedVideos.slice(0, 10)) {
        console.log(`• ❌ ${video.filename}`);
      }
    }
    console.log('─'.repeat(67) + '\n');
  }

  private formatProgressBar(percent: number): string {
    const barWidth = 30;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    return `[${bar}] ${percent.toString().padStart(3)}%`;
  }

  private formatStats(): string {
    return `${this.completedVideoCount}/${this.totalVideos} videos • ${this.completedChunkCount}/${this.totalChunks} chunks`;
  }

  private formatThroughput(): string {
    const elapsedMs = Date.now() - this.startTime;
    if (elapsedMs === 0 || this.completedChunkCount === 0) {
      return 'Starting...';
    }

    const rate = this.completedChunkCount / (elapsedMs / 1000);
    const remaining = this.totalChunks - this.completedChunkCount;
    const etaSeconds = remaining > 0 ? remaining / rate : 0;

    return `${rate.toFixed(1)} chunks/sec • ETA: ${this.formatDuration(etaSeconds)}`;
  }

  private formatPool(): string {
    const activeSlots = Math.min(this.inFlightVideos, this.maxConcurrency);
    const poolWidth = Math.min(this.maxConcurrency, 20);
    const activeVisual = Math.round(
      (activeSlots / this.maxConcurrency) * poolWidth,
    );
    const poolBar =
      '▶'.repeat(activeVisual) + '░'.repeat(poolWidth - activeVisual);
    const queueDepth =
      this.totalVideos - this.completedVideoCount - this.inFlightVideos;

    return `Pool: [${poolBar}] ${this.inFlightVideos}/${this.maxConcurrency} active • ${queueDepth} queued`;
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
