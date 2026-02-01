import { EventEmitter } from 'node:events';

interface ActiveJob {
  videoId: number;
  filename: string;
  chunkNum: number;
  totalChunks: number;
  currentTitle: string | null;
  lastUpdated?: number; // timestamp for sorting by recency (set internally by TUI)
}

interface ActivityLine {
  type: 'success' | 'error' | 'info';
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
}

export class TUI extends EventEmitter {
  private activeJobs = new Map<number, ActiveJob>();
  private recentLines: ActivityLine[] = [];
  private totalChunks = 0;
  private completedChunks = 0;
  private completedVideos = 0;
  private totalVideos = 0;
  private totalScenes = 0;
  private readonly maxLines = 5;
  private readonly width = 80;
  private readonly maxActiveDisplay = 4; // Show top 4 most recent jobs
  private isActive = false;
  private errorDisplayUntil = 0;
  private errorMessage: string | null = null;
  private shutdownMessage: string | null = null;

  start(totalChunks: number, totalVideos: number): void {
    this.totalChunks = totalChunks;
    this.totalVideos = totalVideos;
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
    this.completedChunks = completedChunks;
    this.completedVideos = completedVideos;
    this.totalScenes = totalScenes;
    if (this.isActive) this.render();
  }

  setActiveJob(job: ActiveJob): void {
    // Add/update timestamp for recency tracking
    job.lastUpdated = Date.now();
    this.activeJobs.set(job.videoId, job);
    if (this.isActive) this.render();
  }

  removeActiveJob(videoId: number): void {
    this.activeJobs.delete(videoId);
    if (this.isActive) this.render();
  }

  addActivity(type: ActivityLine['type'], message: string): void {
    this.recentLines.push({ type, message, timestamp: Date.now() });
    if (this.recentLines.length > this.maxLines) {
      this.recentLines.shift();
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

  private render(): void {
    const now = Date.now();
    const showError = this.errorMessage && now < this.errorDisplayUntil;

    // Build output
    let output = '';

    // Header with chunk-based progress
    const percent =
      this.totalChunks > 0
        ? Math.round((this.completedChunks / this.totalChunks) * 100)
        : 0;
    const barWidth = 30;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

    output += `┌${'─'.repeat(this.width - 2)}┐\n`;
    // Header line: emoji takes 2 display columns, so we adjust spacing
    const headerText = this.shutdownMessage
      ? '⚠️ Shutting Down...'
      : '🎬 Video Archivist';
    const headerPadding = 2; // Extra spaces to account for emoji display width
    const rightSideContent = `[${bar}] ${percent.toString().padStart(3)}%`;
    const spaceBetween =
      this.width -
      4 -
      headerText.length -
      headerPadding -
      rightSideContent.length;
    output += `│ ${headerText}${' '.repeat(Math.max(0, spaceBetween))}${rightSideContent} │\n`;

    // Stats line: show chunks, videos, and scenes
    const statsText = `${this.completedChunks}/${this.totalChunks} chunks • ${this.completedVideos}/${this.totalVideos} videos • ${this.totalScenes} scenes`;
    const statsPadding = Math.max(0, this.width - 2 - statsText.length);
    const leftStatsPad = Math.floor(statsPadding / 2);
    const rightStatsPad = statsPadding - leftStatsPad;
    output += `│${' '.repeat(leftStatsPad)}${statsText}${' '.repeat(rightStatsPad)}│\n`;

    // Active jobs section - show top N most recently updated
    output += `├${'─'.repeat(this.width - 2)}┤\n`;

    // Sort jobs by last updated (most recent first) and take top N
    const sortedJobs = Array.from(this.activeJobs.values())
      .sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0))
      .slice(0, this.maxActiveDisplay);

    const totalActive = this.activeJobs.size;
    const showingCount = sortedJobs.length;
    const activeHeader =
      totalActive > showingCount
        ? `ACTIVE CHUNKS (${showingCount} of ${totalActive}):`
        : `ACTIVE CHUNKS (${totalActive}):`;
    output += `│ ${activeHeader}${' '.repeat(Math.max(0, this.width - 3 - activeHeader.length))}│\n`;

    if (sortedJobs.length === 0) {
      const waitingText = '  (waiting for chunks...)';
      output += `│ ${waitingText}${' '.repeat(Math.max(0, this.width - 3 - waitingText.length))}│\n`;
    } else {
      for (const job of sortedJobs) {
        const title = job.currentTitle
          ? ` • "${this.truncate(job.currentTitle, 20)}"`
          : '';
        // More compact display: filename truncated to 15 chars
        const line = `▶ ${this.truncate(job.filename, 15)} [${job.chunkNum}/${job.totalChunks}]${title}`;
        output += `│ ${line}${' '.repeat(Math.max(0, this.width - 3 - line.length))}│\n`;
      }
    }

    // Fill remaining active job slots to keep layout stable
    for (let i = sortedJobs.length; i < this.maxActiveDisplay; i++) {
      output += `│${' '.repeat(this.width - 2)}│\n`;
    }

    // Recent activity section
    output += `├${'─'.repeat(this.width - 2)}┤\n`;

    if (showError && this.errorMessage) {
      // Show error instead of recent lines
      const errorLines = this.wrapText(
        `❌ ${this.errorMessage}`,
        this.width - 4,
      );
      for (const line of errorLines.slice(0, this.maxLines)) {
        output += `│ \x1b[91m${line}\x1b[0m${' '.repeat(Math.max(0, this.width - 4 - line.length))}│\n`;
      }
      // Fill rest with empty lines
      for (let i = errorLines.length; i < this.maxLines; i++) {
        output += `│${' '.repeat(this.width - 2)}│\n`;
      }
    } else {
      // Show recent activity
      for (let i = 0; i < this.maxLines; i++) {
        const line = this.recentLines[i];
        if (line) {
          const prefix =
            line.type === 'success'
              ? '✅'
              : line.type === 'error'
                ? '❌'
                : 'ℹ️';
          const color =
            line.type === 'success'
              ? '\x1b[92m'
              : line.type === 'error'
                ? '\x1b[91m'
                : '\x1b[96m';
          const reset = '\x1b[0m';
          const text = `${prefix} ${line.message}`;
          const displayText = this.truncate(text, this.width - 4);
          output += `│ ${color}${displayText}${reset}${' '.repeat(Math.max(0, this.width - 4 - displayText.length))}│\n`;
        } else {
          output += `│${' '.repeat(this.width - 2)}│\n`;
        }
      }
    }

    output += `└${'─'.repeat(this.width - 2)}┘`;

    // Clear and redraw
    this.write(`\x1b[H\x1b[2J${output}`);
  }

  finalize(stats: SummaryStats): void {
    this.stop();

    // Print summary table
    console.log(`┌${'─'.repeat(this.width - 2)}┐`);
    const completeHeader = '🏁 COMPLETE';
    console.log(
      `│ ${completeHeader}${' '.repeat(Math.max(0, this.width - 3 - completeHeader.length))}│`,
    );
    console.log(`├${'─'.repeat(this.width - 2)}┤`);

    const chunkLine = `Total Chunks: ${stats.completedChunks}/${stats.totalChunks}`;
    console.log(
      `│ ${chunkLine}${' '.repeat(Math.max(0, this.width - 3 - chunkLine.length))}│`,
    );

    const videoLine = `Total Videos: ${stats.completedVideos}/${stats.totalVideos}`;
    console.log(
      `│ ${videoLine}${' '.repeat(Math.max(0, this.width - 3 - videoLine.length))}│`,
    );

    const sceneLine = `Total Scenes: ${stats.totalScenes}`;
    console.log(
      `│ ${sceneLine}${' '.repeat(Math.max(0, this.width - 3 - sceneLine.length))}│`,
    );

    if (stats.errors.length > 0) {
      const errorLine = `Errors: ${stats.errors.length}`;
      console.log(
        `│ ${errorLine}${' '.repeat(Math.max(0, this.width - 3 - errorLine.length))}│`,
      );
      console.log(`├${'─'.repeat(this.width - 2)}┤`);
      const errorDetailHeader = 'ERROR DETAILS:';
      console.log(
        `│ ${errorDetailHeader}${' '.repeat(Math.max(0, this.width - 3 - errorDetailHeader.length))}│`,
      );
      for (const err of stats.errors.slice(0, 5)) {
        const line = `• ${this.truncate(err.filename, 20)}: ${this.truncate(err.error, 35)}`;
        console.log(
          `│ ${line}${' '.repeat(Math.max(0, this.width - 3 - line.length))}│`,
        );
      }
      if (stats.errors.length > 5) {
        const moreLine = `... and ${stats.errors.length - 5} more`;
        console.log(
          `│ ${moreLine}${' '.repeat(Math.max(0, this.width - 3 - moreLine.length))}│`,
        );
      }
    }

    if (stats.warnings.length > 0) {
      console.log(`├${'─'.repeat(this.width - 2)}┤`);
      const warnHeader = 'WARNINGS:';
      console.log(
        `│ ${warnHeader}${' '.repeat(Math.max(0, this.width - 3 - warnHeader.length))}│`,
      );
      for (const warn of stats.warnings.slice(0, 3)) {
        const line = `• ${this.truncate(warn.filename, 25)}: ${warn.message}`;
        console.log(
          `│ ${line}${' '.repeat(Math.max(0, this.width - 3 - line.length))}│`,
        );
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
      if ((currentLine + word).length > width) {
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
