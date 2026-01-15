/**
 * Simple Logger for the Orchestrator
 */
export const Logger = {
  info: (msg: string) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`),
  error: (msg: string, err?: any) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, err || ""),
  
  /**
   * Basic progress indicator
   */
  progress: (current: number, total: number, label: string) => {
    const formatSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    const percent = ((current / total) * 100).toFixed(1);
    process.stdout.write(`\r[PROGRESS] ${label}: ${percent}% (${formatSize(current)}/${formatSize(total)})`);
    if (current === total) console.log(""); 
  }
};
