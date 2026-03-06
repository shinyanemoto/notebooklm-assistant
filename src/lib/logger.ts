export class Logger {
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  info(scope: string, ...args: unknown[]): void {
    if (!this.enabled) return;
    console.info(`[NLM-Assistant][${scope}]`, ...args);
  }

  warn(scope: string, ...args: unknown[]): void {
    if (!this.enabled) return;
    console.warn(`[NLM-Assistant][${scope}]`, ...args);
  }

  error(scope: string, ...args: unknown[]): void {
    if (!this.enabled) return;
    console.error(`[NLM-Assistant][${scope}]`, ...args);
  }
}

export const logger = new Logger();
