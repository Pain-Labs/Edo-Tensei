/**
 * MCP Structured Logging utility
 */

import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';

const LOG_LEVEL_ORDER: LoggingLevel[] = [
  'debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'
];

export class Logger {
  private static currentLevel: LoggingLevel = 'info';

  static setLevel(level: LoggingLevel): void {
    this.currentLevel = level;
  }

  static getLevel(): LoggingLevel {
    return this.currentLevel;
  }

  private static shouldLog(level: LoggingLevel): boolean {
    return LOG_LEVEL_ORDER.indexOf(level) >= LOG_LEVEL_ORDER.indexOf(this.currentLevel);
  }

  private static log(level: LoggingLevel, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    if (data !== undefined) {
      console.error(`${prefix} ${message}`, JSON.stringify(data, null, 2));
    } else {
      console.error(`${prefix} ${message}`);
    }
  }

  static debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  static info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  static warning(message: string, data?: unknown): void {
    this.log('warning', message, data);
  }

  static error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  static logError(context: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    this.error(`Error in ${context}: ${errorMessage}`, stack);
  }
}
