/**
 * Terminal spinner for showing loading/progress states.
 * Uses braille dots for smooth animation.
 */

export class Spinner {
  private frames = ['⣷', '⣯', '⣟', '⡿', '⢿', '⣻', '⣽', '⣾'];
  private timer: Timer | null = null;
  private frameIndex = 0;
  private text: string;
  private interval: number;

  constructor(text = 'Thinking', interval = 100) {
    this.text = text;
    this.interval = interval;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      process.stdout.write(`\r${this.text} - ${this.frames[this.frameIndex]}`);
    }, this.interval);
  }

  stop(finalFrame = '✓'): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    process.stdout.write(`\rComplete! - ${finalFrame}\n`);
  }
}
