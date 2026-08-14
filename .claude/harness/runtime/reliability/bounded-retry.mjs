const TRANSIENT_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN"]);

export class RetryExhaustedError extends Error {
  constructor(message, attempts, cause) {
    super(message, { cause });
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
  }
}

export function isTransientInfrastructureFailure(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
    || TRANSIENT_CODES.has(error?.code);
}

export async function boundedRetry(operation, options = {}) {
  if (typeof operation !== "function") throw new TypeError("operation must be a function");
  const {
    idempotent = false,
    maxAttempts = 3,
    baseDelayMs = 100,
    maxDelayMs = 2_000,
    timeoutMs = 30_000,
    retryBudgetMs = 10_000,
    classify = isTransientInfrastructureFailure,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    onAttempt = () => {},
  } = options;
  if (!idempotent) throw new TypeError("boundedRetry requires idempotent: true");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError("maxAttempts must be a positive integer");

  const started = Date.now();
  let lastError;
  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      const value = await withTimeout(operation({ attempt }), timeoutMs);
      onAttempt({ attempt, status: "completed" });
      return value;
    } catch (error) {
      lastError = error;
      const transient = Boolean(classify(error));
      onAttempt({ attempt, status: "failed", transient, code: error?.code || null, httpStatus: error?.status || error?.statusCode || null });
      if (!transient || attempt === maxAttempts) break;
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.floor(exponential * (0.5 + random() * 0.5));
      if (Date.now() - started + delay > retryBudgetMs) break;
      await sleep(delay);
    }
  }
  throw new RetryExhaustedError("bounded infrastructure retry exhausted", attempts, lastError);
}

async function withTimeout(operation, timeoutMs) {
  if (!(timeoutMs > 0)) return operation;
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`operation timed out after ${timeoutMs}ms`);
          error.code = "ETIMEDOUT";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
