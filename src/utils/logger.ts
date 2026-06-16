import pino from 'pino';

// Install command to include in output: npm install pino

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  base: null
});

export function createLogger(component: string): pino.Logger {
  return logger.child({ component });
}

export default logger;
