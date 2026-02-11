interface SimpleProgressOptions {
  total: number;
  label: string;
}

export class SimpleProgress {
  private total: number;
  private completed = 0;
  private startTime: number;
  private label: string;
  private lastLineLength = 0;

  constructor(options: SimpleProgressOptions) {
    this.total = options.total;
    this.label = options.label;
    this.startTime = Date.now();
    this.render();
  }

  increment(): void {
    this.completed++;
    this.render();
  }

  private render(): void {
    const percent =
      this.total > 0 ? Math.round((this.completed / this.total) * 100) : 0;
    const barWidth = 30;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

    const elapsedMs = Date.now() - this.startTime;
    const rate =
      elapsedMs > 0 && this.completed > 0
        ? this.completed / (elapsedMs / 1000)
        : 0;
    const remaining = this.total - this.completed;
    const etaSeconds = rate > 0 && remaining > 0 ? remaining / rate : 0;

    let etaStr = '';
    if (etaSeconds > 0) {
      if (etaSeconds < 60) {
        etaStr = `${Math.round(etaSeconds)}s`;
      } else if (etaSeconds < 3600) {
        etaStr = `${Math.floor(etaSeconds / 60)}m ${Math.round(etaSeconds % 60)}s`;
      } else {
        etaStr = `${Math.floor(etaSeconds / 3600)}h ${Math.round((etaSeconds % 3600) / 60)}m`;
      }
    }

    const line = `${this.label} [${bar}] ${percent.toString().padStart(3)}% ${this.completed}/${this.total}${etaStr ? ` ETA: ${etaStr}` : ''}`;

    // Clear previous line and write new one
    process.stdout.write('\r' + ' '.repeat(this.lastLineLength) + '\r');
    process.stdout.write(line);
    this.lastLineLength = line.length;
  }

  stop(finalMessage?: string): void {
    process.stdout.write('\r' + ' '.repeat(this.lastLineLength) + '\r');
    if (finalMessage) {
      console.log(finalMessage);
    }
  }
}

interface SimpleVideoProgress {
  filename: string;
  chunkCount: number;
  durationMs: number;
  hadError: boolean;
}

export class SimpleVideoLogger {
  private total: number;
  private completed = 0;
  private startTime: number;

  constructor(total: number) {
    this.total = total;
    this.startTime = Date.now();
    console.log(`📚 Global Archivist: Processing ${total} videos...\n`);
  }

  recordVideo(video: SimpleVideoProgress): void {
    this.completed++;
    const duration =
      video.durationMs < 1000
        ? `${video.durationMs}ms`
        : `${(video.durationMs / 1000).toFixed(1)}s`;

    const chunks = video.chunkCount > 0 ? ` (${video.chunkCount} chunks)` : '';
    const icon = video.hadError ? '❌' : '✅';

    console.log(
      `${icon} ${video.filename}${chunks} - ${duration} (${this.completed}/${this.total})`,
    );
  }

  finalize(completed: number, errors: number): void {
    const elapsedMs = Date.now() - this.startTime;
    const elapsedText =
      elapsedMs < 60000
        ? `${(elapsedMs / 1000).toFixed(1)}s`
        : elapsedMs < 3600000
          ? `${Math.floor(elapsedMs / 60000)}m ${Math.round((elapsedMs % 60000) / 1000)}s`
          : `${Math.floor(elapsedMs / 3600000)}h ${Math.round((elapsedMs % 3600000) / 60000)}m`;

    console.log('\n' + '─'.repeat(67));
    console.log(
      `🏁 Complete: ${completed}/${this.total} videos in ${elapsedText}`,
    );
    if (errors > 0) {
      console.log(`⚠️  ${errors} error(s) occurred`);
    }
    console.log('─'.repeat(67));
  }
}
