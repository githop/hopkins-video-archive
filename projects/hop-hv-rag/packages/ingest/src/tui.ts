import { EventEmitter } from 'node:events';

interface CompletedChunk {
  videoId: number;
  filename: string;
  chunkNum: number;
  totalChunks: number;
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
  totalVideos: number;
  completedVideos: number;
  totalChunks: number;
  completedChunks: number;
  totalScenes: number;
  errors: Array<{ videoId: number; filename: string; error: string }>;
  warnings: Array<{ videoId: number; filename: string; message: string }>;
  failedChunks: Array<{
    videoId: number;
    filename: string;
    chunkNum: number;
    totalChunks: number;
    errorType: 'ai-parse' | 'api' | 'unknown';
    errorMessage: string;
  }>;
}

export class TUI extends EventEmitter {
  private startTime = 0;
  private recentActivity: ActivityLine[] = [];
  private inFlightChunks = 0;
  private maxConcurrency = 0;
  private totalChunks = 0;
  private completedChunkCount = 0;
  private completedVideos = 0;
  private totalVideos = 0;
  private totalScenes = 0;
  private readonly maxActivityLines = 8;
  private readonly width = 80;
  private isActive = false;
  private errorDisplayUntil = 0;
  private errorMessage: string | null = null;
  private shutdownMessage: string | null = null;

  start(
    totalChunks: number,
    totalVideos: number,
    maxConcurrency: number,
  ): void {
    this.totalChunks = totalChunks;
    this.totalVideos = totalVideos;
    this.maxConcurrency = maxConcurrency;
    this.startTime = Date.now();
    this.isActive = true;
    this.enterAltScreen();
    this.hideCursor();
    this.clearScreen();
    this.render();
  }

  stop(): void {
    this.isActive = false;
    this.showCursor();
    this.exitAltScreen();
  }

  updateProgress(
    completedChunks: number,
    completedVideos: number,
    totalScenes: number,
  ): void {
    this.completedChunkCount = completedChunks;
    this.completedVideos = completedVideos;
    this.totalScenes = totalScenes;
    if (this.isActive) this.render();
  }

  setInFlightCount(count: number): void {
    this.inFlightChunks = count;
    if (this.isActive) this.render();
  }

  recordChunkComplete(chunk: CompletedChunk): void {
    // Build message WITHOUT the icon - the activity renderer adds it
    const title = chunk.title ? ` "${this.truncate(chunk.title, 22)}"` : '';
    const duration =
      chunk.durationMs < 1000
        ? `${chunk.durationMs}ms`
        : `${(chunk.durationMs / 1000).toFixed(1)}s`;
    const message = chunk.hadError
      ? `${this.truncate(chunk.filename, 25)} chunk ${chunk.chunkNum}/${chunk.totalChunks} (${duration})`
      : `${this.truncate(chunk.filename, 25)} chunk ${chunk.chunkNum}/${chunk.totalChunks}${title} (${duration})`;

    // Determine activity type based on error type
    let activityType: ActivityLine['type'] = 'success';
    if (chunk.hadError) {
      activityType = chunk.errorType === 'ai-parse' ? 'warning' : 'error';
    }

    this.addActivity(activityType, message);
  }

  addActivity(type: ActivityLine['type'], message: string): void {
    this.recentActivity.push({ type, message, timestamp: Date.now() });
    if (this.recentActivity.length > this.maxActivityLines) {
      this.recentActivity.shift();
    }
    if (this.isActive) this.render();
  }

  showError(message: string, durationMs: number = 10000): void {
    this.errorMessage = message;
    this.errorDisplayUntil = Date.now() + durationMs;
    if (this.isActive) this.render();
  }

  showShutdownMessage(message: string): void {
    this.shutdownMessage = message;
    if (this.isActive) this.render();
  }

  private displayWidth(str: string): number {
    // Count emoji and other wide chars as 2 display columns
    let width = 0;
    for (const char of str) {
      const code = char.codePointAt(0) ?? 0;
      // Emoji ranges and CJK chars are typically 2 columns wide
      if (
        (code >= 0x1f600 && code <= 0x1f64f) || // Emoticons
        (code >= 0x1f300 && code <= 0x1f5ff) || // Misc symbols
        (code >= 0x1f680 && code <= 0x1f6ff) || // Transport
        (code >= 0x2600 && code <= 0x26ff) || // Misc symbols
        (code >= 0x2700 && code <= 0x27bf) || // Dingbats
        (code >= 0x1f900 && code <= 0x1f9ff) || // Supplemental
        (code >= 0x1f1e6 && code <= 0x1f1ff) || // Flags
        code === 0x26a0 || // Warning sign
        code === 0x2713 || // Check mark
        code === 0x2714 || // Heavy check
        code === 0x2715 || // Multiplication x
        code === 0x2716 || // Heavy x
        code === 0x274c || // Cross mark
        code === 0x274e // Negative cross
      ) {
        width += 2;
      } else {
        width += 1;
      }
    }
    return width;
  }

  private padLine(content: string, totalWidth: number): string {
    const contentWidth = this.displayWidth(content);
    const padding = Math.max(0, totalWidth - contentWidth);
    return content + ' '.repeat(padding);
  }

  private centerLine(content: string, totalWidth: number): string {
    const contentWidth = this.displayWidth(content);
    const padding = Math.max(0, totalWidth - contentWidth);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return ' '.repeat(leftPad) + content + ' '.repeat(rightPad);
  }

  private getThroughputMetrics(): { rate: number; etaSeconds: number } {
    const elapsedMs = Date.now() - this.startTime;
    if (elapsedMs === 0 || this.completedChunkCount === 0) {
      return { rate: 0, etaSeconds: 0 };
    }

    const rate = this.completedChunkCount / (elapsedMs / 1000); // chunks per second
    const remaining = this.totalChunks - this.completedChunkCount;
    const etaSeconds = remaining > 0 ? remaining / rate : 0;

    return { rate, etaSeconds };
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600)
      return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }

  private render(): void {
    const now = Date.now();
    const showError = this.errorMessage && now < this.errorDisplayUntil;
    const { rate, etaSeconds } = this.getThroughputMetrics();

    let output = '';

    // Top border
    output += `┌${'─'.repeat(this.width - 2)}┐\n`;

    // Header with progress bar
    const percent =
      this.totalChunks > 0
        ? Math.round((this.completedChunkCount / this.totalChunks) * 100)
        : 0;
    const barWidth = 25;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

    const headerText = this.shutdownMessage
      ? '⚠️ Shutting Down...'
      : '🎬 Video Archivist';
    const rightSideContent = `[${bar}] ${percent.toString().padStart(3)}%`;
    const headerLine = `${headerText}${' '.repeat(Math.max(1, this.width - 4 - this.displayWidth(headerText) - rightSideContent.length))}${rightSideContent}`;
    output += `│ ${this.padLine(headerLine, this.width - 3)}│\n`;

    // Stats line
    const statsText = `${this.completedChunkCount}/${this.totalChunks} chunks • ${this.completedVideos}/${this.totalVideos} videos • ${this.totalScenes} scenes`;
    output += `│${this.centerLine(statsText, this.width - 2)}│\n`;

    // Throughput metrics line
    const rateText =
      rate > 0
        ? `${rate.toFixed(1)} chunks/sec • ETA: ${this.formatDuration(etaSeconds)}`
        : 'Starting...';
    output += `│${this.centerLine(rateText, this.width - 2)}│\n`;

    // Concurrency pool visualization
    output += `├${'─'.repeat(this.width - 2)}┤\n`;

    const activeSlots = Math.min(this.inFlightChunks, this.maxConcurrency);
    const poolWidth = Math.min(this.maxConcurrency, 20); // Cap visual width
    const activeVisual = Math.round(
      (activeSlots / this.maxConcurrency) * poolWidth,
    );
    const poolBar =
      '▶'.repeat(activeVisual) + '░'.repeat(poolWidth - activeVisual);
    const queueDepth =
      this.totalChunks - this.completedChunkCount - this.inFlightChunks;
    const poolText = `Pool: [${poolBar}] ${this.inFlightChunks}/${this.maxConcurrency} active • ${queueDepth} queued`;
    output += `│${this.centerLine(poolText, this.width - 2)}│\n`;

    // Activity section
    output += `├${'─'.repeat(this.width - 2)}┤\n`;

    if (showError && this.errorMessage) {
      const errorLines = this.wrapText(
        `❌ ${this.errorMessage}`,
        this.width - 4,
      );
      for (const line of errorLines.slice(0, this.maxActivityLines)) {
        const paddedLine = this.padLine(line, this.width - 4);
        output += `│ \x1b[91m${paddedLine}\x1b[0m│\n`;
      }
      for (let i = errorLines.length; i < this.maxActivityLines; i++) {
        output += `│${' '.repeat(this.width - 2)}│\n`;
      }
    } else {
      for (let i = 0; i < this.maxActivityLines; i++) {
        const line = this.recentActivity[i];
        if (line) {
          const prefix =
            line.type === 'success'
              ? '✅'
              : line.type === 'error'
                ? '❌'
                : line.type === 'warning'
                  ? '⚠️'
                  : 'ℹ️';
          const color =
            line.type === 'success'
              ? '\x1b[92m'
              : line.type === 'error'
                ? '\x1b[91m'
                : line.type === 'warning'
                  ? '\x1b[93m'
                  : '\x1b[96m';
          const reset = '\x1b[0m';
          const text = `${prefix} ${line.message}`;
          const paddedText = this.padLine(text, this.width - 4);
          output += `│ ${color}${paddedText}${reset}│\n`;
        } else {
          output += `│${' '.repeat(this.width - 2)}│\n`;
        }
      }
    }

    // Bottom border
    output += `└${'─'.repeat(this.width - 2)}┘`;

    this.write(`\x1b[H\x1b[2J${output}`);
  }

  finalize(stats: SummaryStats): void {
    this.stop();

    const elapsedMs = Date.now() - this.startTime;
    const elapsedText = this.formatDuration(elapsedMs / 1000);
    const avgRate =
      elapsedMs > 0
        ? (stats.completedChunks / (elapsedMs / 1000)).toFixed(1)
        : '0.0';

    console.log(`┌${'─'.repeat(this.width - 2)}┐`);
    const completeHeader = '🏁 COMPLETE';
    console.log(`│ ${this.padLine(completeHeader, this.width - 3)}│`);
    console.log(`├${'─'.repeat(this.width - 2)}┤`);

    const timeLine = `Total Time: ${elapsedText}`;
    console.log(`│ ${this.padLine(timeLine, this.width - 3)}│`);

    const rateLine = `Avg Rate: ${avgRate} chunks/sec`;
    console.log(`│ ${this.padLine(rateLine, this.width - 3)}│`);

    const chunkLine = `Total Chunks: ${stats.completedChunks}/${stats.totalChunks}`;
    console.log(`│ ${this.padLine(chunkLine, this.width - 3)}│`);

    const videoLine = `Total Videos: ${stats.completedVideos}/${stats.totalVideos}`;
    console.log(`│ ${this.padLine(videoLine, this.width - 3)}│`);

    const sceneLine = `Total Scenes: ${stats.totalScenes}`;
    console.log(`│ ${this.padLine(sceneLine, this.width - 3)}│`);

    if (stats.errors.length > 0) {
      const errorLine = `Errors: ${stats.errors.length}`;
      console.log(`│ ${this.padLine(errorLine, this.width - 3)}│`);
      console.log(`├${'─'.repeat(this.width - 2)}┤`);
      const errorDetailHeader = 'ERROR DETAILS:';
      console.log(`│ ${this.padLine(errorDetailHeader, this.width - 3)}│`);
      for (const err of stats.errors.slice(0, 5)) {
        const line = `• ${this.truncate(err.filename, 20)}: ${this.truncate(err.error, 35)}`;
        console.log(`│ ${this.padLine(line, this.width - 3)}│`);
      }
      if (stats.errors.length > 5) {
        const moreLine = `... and ${stats.errors.length - 5} more`;
        console.log(`│ ${this.padLine(moreLine, this.width - 3)}│`);
      }
    }

    if (stats.failedChunks.length > 0) {
      console.log(`├${'─'.repeat(this.width - 2)}┤`);
      const failedHeader = `FAILED CHUNKS: ${stats.failedChunks.length}`;
      console.log(`│ ${this.padLine(failedHeader, this.width - 3)}│`);
      for (const chunk of stats.failedChunks.slice(0, 5)) {
        const icon = chunk.errorType === 'ai-parse' ? '⚠️' : '❌';
        const errorLabel =
          chunk.errorType === 'ai-parse'
            ? 'AI'
            : chunk.errorType === 'api'
              ? 'API'
              : 'ERR';
        const line = `• ${icon} ${this.truncate(chunk.filename, 20)} chunk ${chunk.chunkNum}/${chunk.totalChunks} (${errorLabel})`;
        console.log(`│ ${this.padLine(line, this.width - 3)}│`);
      }
      if (stats.failedChunks.length > 5) {
        const moreLine = `... and ${stats.failedChunks.length - 5} more`;
        console.log(`│ ${this.padLine(moreLine, this.width - 3)}│`);
      }
    }

    if (stats.warnings.length > 0) {
      console.log(`├${'─'.repeat(this.width - 2)}┤`);
      const warnHeader = 'WARNINGS:';
      console.log(`│ ${this.padLine(warnHeader, this.width - 3)}│`);
      for (const warn of stats.warnings.slice(0, 3)) {
        const line = `• ${this.truncate(warn.filename, 25)}: ${warn.message}`;
        console.log(`│ ${this.padLine(line, this.width - 3)}│`);
      }
    }

    console.log(`└${'─'.repeat(this.width - 2)}┘`);
  }

  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
  }

  private wrapText(text: string, width: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (this.displayWidth(currentLine + word) > width) {
        lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        currentLine += word + ' ';
      }
    }
    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    return lines;
  }

  private enterAltScreen(): void {
    this.write('\x1b[?1049h');
  }

  private exitAltScreen(): void {
    this.write('\x1b[?1049l');
  }

  private hideCursor(): void {
    this.write('\x1b[?25l');
  }

  private showCursor(): void {
    this.write('\x1b[?25h');
  }

  private clearScreen(): void {
    this.write('\x1b[2J\x1b[H');
  }

  private write(str: string): void {
    process.stdout.write(str);
  }
}
