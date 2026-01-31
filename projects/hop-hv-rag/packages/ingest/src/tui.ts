import { EventEmitter } from 'node:events';

interface ActiveJob {
  videoId: number;
  filename: string;
  chunkNum: number;
  totalChunks: number;
  currentTitle: string | null;
}

interface ActivityLine {
  type: 'success' | 'error' | 'info';
  message: string;
  timestamp: number;
}

interface SummaryStats {
  totalVideos: number;
  completedVideos: number;
  totalScenes: number;
  errors: Array<{ videoId: number; filename: string; error: string }>;
  warnings: Array<{ videoId: number; filename: string; message: string }>;
}

export class TUI extends EventEmitter {
  private activeJobs = new Map<number, ActiveJob>();
  private recentLines: ActivityLine[] = [];
  private totalVideos = 0;
  private completedVideos = 0;
  private totalScenes = 0;
  private readonly maxLines = 5;
  private readonly width = 80;
  private isActive = false;
  private errorDisplayUntil = 0;
  private errorMessage: string | null = null;

  start(totalVideos: number): void {
    this.totalVideos = totalVideos;
    this.isActive = true;
    this.hideCursor();
    this.clearScreen();
    this.render();
  }

  stop(): void {
    this.isActive = false;
    this.showCursor();
  }

  updateProgress(completedVideos: number, totalScenes: number): void {
    this.completedVideos = completedVideos;
    this.totalScenes = totalScenes;
    if (this.isActive) this.render();
  }

  setActiveJob(job: ActiveJob): void {
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

  private render(): void {
    const now = Date.now();
    const showError = this.errorMessage && now < this.errorDisplayUntil;

    // Build output
    let output = '';

    // Header with progress
    const percent =
      this.totalVideos > 0
        ? Math.round((this.completedVideos / this.totalVideos) * 100)
        : 0;
    const barWidth = 30;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

    output += `┌${'─'.repeat(this.width - 2)}┐\n`;
    output += `│ 🎬 Video Archivist${' '.repeat(14)}[${bar}] ${percent.toString().padStart(3)}% │\n`;
    output += `│${' '.repeat(27)}${this.completedVideos}/${this.totalVideos} videos • ${this.totalScenes} scenes${' '.repeat(Math.max(0, this.width - 43 - this.totalVideos.toString().length - this.completedVideos.toString().length - this.totalScenes.toString().length))}│\n`;

    // Active jobs section
    output += `├${'─'.repeat(this.width - 2)}┤\n`;
    output += `│ ACTIVE (${this.activeJobs.size}):${' '.repeat(this.width - 14 - this.activeJobs.size.toString().length)}│\n`;

    if (this.activeJobs.size === 0) {
      output += `│   (waiting...)${' '.repeat(this.width - 17)}│\n`;
    } else {
      for (const job of this.activeJobs.values()) {
        const title = job.currentTitle
          ? ` • "${this.truncate(job.currentTitle, 25)}"`
          : '';
        const line = `   ▶ ${this.truncate(job.filename, 18)} chunk ${job.chunkNum}/${job.totalChunks}${title}`;
        output += `│${line}${' '.repeat(Math.max(0, this.width - 3 - line.length))}│\n`;
      }
    }

    // Fill remaining active job slots to keep layout stable
    const activeJobLines = Math.max(1, this.activeJobs.size);
    const maxActiveDisplay = 2; // Max concurrent videos
    for (let i = activeJobLines; i < maxActiveDisplay; i++) {
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
          output += `│ ${color}${displayText}${reset}${' '.repeat(Math.max(0, this.width - 4 - displayText.length))} │\n`;
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
    this.clearScreen();

    // Print summary table
    console.log(`┌${'─'.repeat(this.width - 2)}┐`);
    console.log(`│ 🏁 COMPLETE${' '.repeat(this.width - 15)}│`);
    console.log(`├${'─'.repeat(this.width - 2)}┤`);
    console.log(
      `│ Total Videos: ${stats.completedVideos}/${stats.totalVideos}${' '.repeat(Math.max(0, this.width - 19 - stats.completedVideos.toString().length - stats.totalVideos.toString().length))}│`,
    );
    console.log(
      `│ Total Scenes: ${stats.totalScenes}${' '.repeat(Math.max(0, this.width - 17 - stats.totalScenes.toString().length))}│`,
    );

    if (stats.errors.length > 0) {
      console.log(
        `│ Errors: ${stats.errors.length}${' '.repeat(Math.max(0, this.width - 11 - stats.errors.length.toString().length))}│`,
      );
      console.log(`├${'─'.repeat(this.width - 2)}┤`);
      console.log(`│ ERROR DETAILS:${' '.repeat(this.width - 16)}│`);
      for (const err of stats.errors.slice(0, 5)) {
        const line = `  • ${this.truncate(err.filename, 20)}: ${this.truncate(err.error, 35)}`;
        console.log(
          `│${line}${' '.repeat(Math.max(0, this.width - 3 - line.length))}│`,
        );
      }
      if (stats.errors.length > 5) {
        console.log(
          `│  ... and ${stats.errors.length - 5} more${' '.repeat(Math.max(0, this.width - 16 - (stats.errors.length - 5).toString().length))}│`,
        );
      }
    }

    if (stats.warnings.length > 0) {
      console.log(`├${'─'.repeat(this.width - 2)}┤`);
      console.log(`│ WARNINGS:${' '.repeat(this.width - 12)}│`);
      for (const warn of stats.warnings.slice(0, 3)) {
        const line = `  • ${this.truncate(warn.filename, 25)}: ${warn.message}`;
        console.log(
          `│${line}${' '.repeat(Math.max(0, this.width - 3 - line.length))}│`,
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
