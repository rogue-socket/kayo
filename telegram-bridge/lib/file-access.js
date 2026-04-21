const fs = require('node:fs');
const path = require('node:path');

function formatRelativePath(root, fullPath) {
  const relativePath = path.relative(root.path, fullPath);
  if (!relativePath) {
    return '.';
  }

  return relativePath.replace(/\\/g, '/');
}

function isWithinRoot(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function findRootById(fileRoots, rootId) {
  return fileRoots.find((root) => root.id === rootId) || null;
}

function parseExplicitRootTarget(value) {
  const match = /^([a-z0-9_-]{2,}):(.*)$/i.exec(value);
  if (!match) {
    return null;
  }

  return {
    rootId: match[1].toLowerCase(),
    subPath: match[2].trim()
  };
}

function getRepoRelativePath(config, targetPath) {
  const relativePath = path.relative(config.repoRoot, targetPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return relativePath.replace(/\\/g, '/');
}

function isBlockedPath(config, targetPath) {
  const repoRelativePath = getRepoRelativePath(config, targetPath);
  if (!repoRelativePath) {
    return false;
  }

  if (repoRelativePath === '.git' || repoRelativePath.startsWith('.git/')) {
    return true;
  }

  if (repoRelativePath === '.env' || repoRelativePath.startsWith('.env.')) {
    return true;
  }

  if (repoRelativePath === 'telegram-bridge/.env' || repoRelativePath.startsWith('telegram-bridge/.env.')) {
    return true;
  }

  if (repoRelativePath === 'telegram-bridge/runtime' || repoRelativePath.startsWith('telegram-bridge/runtime/')) {
    return true;
  }

  return false;
}

function normalizeExistingPath(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function resolvePathInput(config, input) {
  const trimmedInput = (input || '').trim();
  if (!trimmedInput) {
    throw new Error('Path is required. Use /files roots to inspect configured aliases.');
  }

  const explicit = parseExplicitRootTarget(trimmedInput);
  if (explicit) {
    const root = findRootById(config.fileRoots, explicit.rootId);
    if (!root) {
      throw new Error(`Unknown file root alias: ${explicit.rootId}`);
    }

    const subPath = explicit.subPath.replace(/^[/\\]+/, '');
    const targetPath = normalizeExistingPath(path.resolve(root.path, subPath || '.'));
    if (!isWithinRoot(root.path, targetPath)) {
      throw new Error('Requested path escapes the configured root.');
    }

    if (isBlockedPath(config, targetPath)) {
      throw new Error('Requested path is blocked by the default file access policy.');
    }

    return {
      root,
      fullPath: targetPath,
      displayPath: `${root.id}:${subPath || '.'}`,
      relativePath: formatRelativePath(root, targetPath)
    };
  }

  if (path.isAbsolute(trimmedInput)) {
    const targetPath = normalizeExistingPath(trimmedInput);
    const root = config.fileRoots.find((candidate) => isWithinRoot(candidate.path, targetPath));

    if (!root) {
      throw new Error('Absolute path is outside the configured file roots.');
    }

    if (isBlockedPath(config, targetPath)) {
      throw new Error('Requested path is blocked by the default file access policy.');
    }

    return {
      root,
      fullPath: targetPath,
      displayPath: `${root.id}:${formatRelativePath(root, targetPath)}`,
      relativePath: formatRelativePath(root, targetPath)
    };
  }

  if (config.fileRoots.length !== 1) {
    throw new Error('Multiple file roots are configured. Use alias:/path, for example repo:/finance/finance-data.json');
  }

  return resolvePathInput(config, `${config.fileRoots[0].id}:${trimmedInput}`);
}

function listRoots(config) {
  return config.fileRoots.map((root) => ({
    id: root.id,
    path: root.path,
    displayPath: root.displayPath
  }));
}

function listDirectory(config, input) {
  const resolved = resolvePathInput(config, input);
  if (!fs.existsSync(resolved.fullPath)) {
    throw new Error('Requested path does not exist.');
  }

  const stat = fs.statSync(resolved.fullPath);
  if (!stat.isDirectory()) {
    throw new Error('Requested path is not a directory.');
  }

  const entries = fs.readdirSync(resolved.fullPath, { withFileTypes: true })
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other'
    }))
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'dir' ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

  return {
    ...resolved,
    entries
  };
}

function getFileForSend(config, input) {
  const resolved = resolvePathInput(config, input);
  if (!fs.existsSync(resolved.fullPath)) {
    throw new Error('Requested file does not exist.');
  }

  const stat = fs.statSync(resolved.fullPath);
  if (!stat.isFile()) {
    throw new Error('Requested path is not a file.');
  }

  if (stat.size > config.fileAccessMaxBytes) {
    throw new Error(`Requested file exceeds the configured size limit of ${config.fileAccessMaxBytes} bytes.`);
  }

  return {
    ...resolved,
    size: stat.size,
    filename: path.basename(resolved.fullPath)
  };
}

module.exports = {
  getFileForSend,
  listDirectory,
  listRoots,
  resolvePathInput
};