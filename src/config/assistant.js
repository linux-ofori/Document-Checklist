function positiveIntegerEnvironmentValue(environment, name, defaultValue, maximumValue) {
  const configuredValue = environment[name];
  if (configuredValue === undefined) {
    return defaultValue;
  }

  if (typeof configuredValue !== 'string' || !/^\d+$/.test(configuredValue)) {
    throw new Error(`${name} must be a safe positive integer no greater than ${maximumValue}.`);
  }

  const value = Number(configuredValue);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximumValue) {
    throw new Error(`${name} must be a safe positive integer no greater than ${maximumValue}.`);
  }

  return value;
}

function loadAssistantConfig(environment = process.env) {
  const enabledValue = environment.ASSISTANT_ENABLED;
  if (enabledValue !== undefined && enabledValue !== 'true' && enabledValue !== 'false') {
    throw new Error('ASSISTANT_ENABLED must be either true or false.');
  }

  return {
    enabled: enabledValue === 'true',
    requestRateLimitMax: positiveIntegerEnvironmentValue(
      environment,
      'ASSISTANT_REQUEST_RATE_LIMIT_MAX',
      10,
      10000
    ),
    requestRateLimitWindowMs: positiveIntegerEnvironmentValue(
      environment,
      'ASSISTANT_REQUEST_RATE_LIMIT_WINDOW_MS',
      15 * 60 * 1000,
      24 * 60 * 60 * 1000
    ),
    requestTimeoutMs: positiveIntegerEnvironmentValue(
      environment,
      'ASSISTANT_REQUEST_TIMEOUT_MS',
      10000,
      60000
    ),
    maxContextBytes: positiveIntegerEnvironmentValue(
      environment,
      'ASSISTANT_MAX_CONTEXT_BYTES',
      32000,
      100000
    )
  };
}

module.exports = { loadAssistantConfig };
