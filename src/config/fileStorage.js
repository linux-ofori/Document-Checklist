const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { uploadsDirectory } = require('./databasePaths');

const extensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const storageKeyPattern = /^[a-f0-9]{64}\.(?:pdf|jpg|jpeg|png)$/;
const contentTypes = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
};

function sanitizeFileName(fileName) {
  if (typeof fileName !== 'string') {
    return null;
  }

  const basename = path.posix.basename(fileName.replace(/\\/g, '/'));
  const sanitized = basename
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 255);

  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : null;
}

function hasPdfSignature(buffer) {
  return buffer.length >= 8 && /^%PDF-[0-9]\.[0-9]/.test(buffer.subarray(0, 8).toString('ascii'));
}

function hasPngSignature(buffer) {
  return buffer.length >= 24
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && buffer.subarray(12, 16).toString('ascii') === 'IHDR'
    && buffer.readUInt32BE(16) > 0
    && buffer.readUInt32BE(20) > 0;
}

function hasJpegStructure(buffer) {
  if (buffer.length < 12 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return false;
  }

  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ]);
  let position = 2;
  let hasFrame = false;

  while (position < buffer.length) {
    if (buffer[position] !== 0xff) {
      return false;
    }
    while (position < buffer.length && buffer[position] === 0xff) {
      position += 1;
    }

    const marker = buffer[position];
    position += 1;
    if (marker === 0xd9 || marker === 0x00 || marker === 0xd8) {
      return false;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (position + 2 > buffer.length) {
      return false;
    }

    const segmentLength = buffer.readUInt16BE(position);
    if (segmentLength < 2 || position + segmentLength > buffer.length) {
      return false;
    }
    if (frameMarkers.has(marker)) {
      if (segmentLength < 8 || buffer[position + 7] === 0
          || segmentLength < 8 + buffer[position + 7] * 3
          || buffer.readUInt16BE(position + 3) === 0
          || buffer.readUInt16BE(position + 5) === 0) {
        return false;
      }
      hasFrame = true;
    }

    position += segmentLength;
    if (marker === 0xda) {
      if (!hasFrame) {
        return false;
      }
      for (let index = position; index + 1 < buffer.length; index += 1) {
        if (buffer[index] === 0xff && buffer[index + 1] === 0xd9) {
          return true;
        }
      }
      return false;
    }
  }

  return false;
}

function validateUploadedFile(file) {
  const fileName = sanitizeFileName(file.originalname);
  if (!fileName) {
    return { error: 'A safe filename is required.' };
  }

  const extension = path.extname(fileName).toLowerCase();
  if (!extensions.has(extension)) {
    return { error: 'Only PDF, JPG, JPEG, and PNG files are supported.' };
  }

  const expectedMimeTypes = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png'
  };
  const mimeType = expectedMimeTypes[extension];
  if (file.mimetype !== mimeType) {
    return { error: 'File extension, content type, and file content must match.' };
  }

  const signatureMatches = extension === '.pdf'
    ? hasPdfSignature(file.buffer)
    : extension === '.png'
      ? hasPngSignature(file.buffer)
      : hasJpegStructure(file.buffer);
  if (!signatureMatches) {
    return { error: 'File extension, content type, and file content must match.' };
  }

  return { fileName, extension };
}

function resolveStoragePath(storageKey) {
  if (typeof storageKey !== 'string' || !storageKeyPattern.test(storageKey)) {
    throw new Error('Invalid internal file storage key.');
  }

  const filePath = path.resolve(uploadsDirectory, storageKey);
  if (path.dirname(filePath) !== uploadsDirectory) {
    throw new Error('Invalid internal file storage key.');
  }
  return filePath;
}

async function readStoredFile(storageKey) {
  const filePath = resolveStoragePath(storageKey);
  const buffer = await fs.readFile(filePath);
  const extension = path.extname(storageKey);

  return {
    buffer,
    contentType: contentTypes[extension]
  };
}

async function storeUploadedFile(buffer, extension) {
  await fs.mkdir(uploadsDirectory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    await fs.chmod(uploadsDirectory, 0o700);
  }

  const storageKey = `${randomBytes(32).toString('hex')}${extension}`;
  const filePath = resolveStoragePath(storageKey);
  try {
    await fs.writeFile(filePath, buffer, { flag: 'wx', mode: 0o600 });
    if (process.platform !== 'win32') {
      await fs.chmod(filePath, 0o600);
    }
  } catch (error) {
    try {
      await fs.unlink(filePath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        console.error('Unable to remove a partial uploaded file.', cleanupError);
      }
    }
    throw error;
  }

  return storageKey;
}

async function removeStoredFile(storageKey) {
  const filePath = resolveStoragePath(storageKey);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

module.exports = {
  readStoredFile,
  removeStoredFile,
  sanitizeFileName,
  storeUploadedFile,
  validateUploadedFile
};
