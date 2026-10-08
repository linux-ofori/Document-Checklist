class FakeEmailProvider {
  constructor({ failure = null, delayMs = 0 } = {}) {
    this.failure = failure;
    this.delayMs = delayMs;
    this.sentMessages = [];
  }

  async sendEmail(message, { signal } = {}) {
    if (this.delayMs > 0) {
      await new Promise((resolve, reject) => {
        if (signal && signal.aborted) {
          reject(new Error('Email provider operation was aborted.'));
          return;
        }

        const onAbort = () => {
          clearTimeout(delay);
          reject(new Error('Email provider operation was aborted.'));
        };
        const delay = setTimeout(() => {
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
          resolve();
        }, this.delayMs);
        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
    if (signal && signal.aborted) {
      throw new Error('Email provider operation was aborted.');
    }
    if (this.failure) {
      throw this.failure;
    }

    this.sentMessages.push({ ...message });
    return { messageId: `fake-${this.sentMessages.length}` };
  }
}

module.exports = FakeEmailProvider;
