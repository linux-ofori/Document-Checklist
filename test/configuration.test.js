const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const temporaryWorkingDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'document-checklist-config-test-')
);
const temporaryDirectoryParent = path.resolve(os.tmpdir());
const serverPath = path.resolve(__dirname, '..', 'src', 'server.js');

after(() => {
  const cleanupTarget = path.resolve(temporaryWorkingDirectory);
  if (path.dirname(cleanupTarget) !== temporaryDirectoryParent
      || !path.basename(cleanupTarget).startsWith('document-checklist-config-test-')) {
    throw new Error('Refusing to remove a path outside this test\'s temporary directory.');
  }
  fs.rmSync(cleanupTarget, { recursive: true, force: true });
});

function startWithJwtSecret(secret) {
  const environment = { ...process.env };
  if (secret === undefined) {
    delete environment.JWT_SECRET;
  } else {
    environment.JWT_SECRET = secret;
  }

  return spawnSync(process.execPath, ['-e', `require(${JSON.stringify(serverPath)})`], {
    cwd: temporaryWorkingDirectory,
    env: environment,
    encoding: 'utf8'
  });
}

test('fails startup when the JWT secret is missing, empty, whitespace-only, or too short', () => {
  for (const [description, secret] of [
    ['missing', undefined],
    ['empty', ''],
    ['whitespace-only', ' '.repeat(32)],
    ['too short', 'short']
  ]) {
    const result = startWithJwtSecret(secret);
    assert.notEqual(result.status, 0, `${description} JWT_SECRET should fail startup`);
    assert.match(
      result.stderr,
      /JWT_SECRET must be configured with at least 32 non-whitespace characters\./
    );
  }
});
