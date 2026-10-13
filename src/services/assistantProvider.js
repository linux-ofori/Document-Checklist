class AssistantProviderError extends Error {
  constructor(code) {
    super(code === 'timeout'
      ? 'The assistant provider timed out.'
      : code === 'disabled'
        ? 'The assistant provider is disabled.'
        : 'The assistant provider request failed.');
    this.name = 'AssistantProviderError';
    this.code = code;
  }
}

function createAssistantProvider({ enabled = false, adapter = null, timeoutMs = 10000 } = {}) {
  if (typeof enabled !== 'boolean') {
    throw new TypeError('Assistant provider enabled state must be a boolean.');
  }
  if (adapter !== null && typeof adapter?.complete !== 'function') {
    throw new TypeError('An assistant adapter must provide a complete function.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Assistant provider timeout must be a safe positive integer.');
  }

  const isEnabled = enabled && adapter !== null;

  async function ask(input) {
    if (!isEnabled) {
      throw new AssistantProviderError('disabled');
    }

    const controller = new AbortController();
    let timeout;
    try {
      return await Promise.race([
        Promise.resolve().then(() => adapter.complete({
          ...input,
          signal: controller.signal
        })),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new AssistantProviderError('timeout'));
          }, timeoutMs);
        })
      ]);
    } catch (error) {
      if (error instanceof AssistantProviderError) {
        throw error;
      }
      throw new AssistantProviderError('failure');
    } finally {
      clearTimeout(timeout);
    }
  }

  return { enabled: isEnabled, ask };
}

module.exports = { AssistantProviderError, createAssistantProvider };
