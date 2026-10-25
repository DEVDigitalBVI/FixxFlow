/**
 * Shared, private storage for cooperating local automation verification scripts.
 * Files live in the ignored .fixxflow-test-artifacts directory of this checkout.
 * Regenerate synthetic sessions with the matching stage12 postgrest helper;
 * legacy shared /tmp artifacts are deliberately never imported automatically.
 * Externally provisioned Supabase/app work directories remain separate.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const automationArtifactsDirectory = fileURLToPath(
  new URL('../../.fixxflow-test-artifacts/', import.meta.url),
);

export function automationArtifacts(directory = automationArtifactsDirectory) {
  directory = path.resolve(directory);
  // The parent is the trusted checkout, not a shared system temporary directory.
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const root = lstatSync(directory);
  if (!root.isDirectory() || root.uid !== process.getuid() || (root.mode & 0o077) !== 0) {
    throw new Error(
      'Automation artifact directory must be an owned private directory (0700), not a symlink.',
    );
  }
  function artifactPath(name) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
      throw new Error('Invalid automation artifact name.');
    return path.join(directory, name);
  }
  function checkFile(file, singleLink = false) {
    if (
      !file.isFile() ||
      file.uid !== process.getuid() ||
      (file.mode & 0o077) !== 0 ||
      (singleLink && file.nlink !== 1)
    ) {
      throw new Error('Automation artifact must be an owned private regular file.');
    }
  }
  function read(name, encoding) {
    const fd = openSync(
      artifactPath(name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      checkFile(fstatSync(fd));
      return readFileSync(fd, encoding);
    } finally {
      closeSync(fd);
    }
  }
  function publish(name, data, exclusive = false) {
    const destination = artifactPath(name),
      temporary = artifactPath(`pending-${randomUUID()}`);
    // No partial report/secret can be observed by another helper process.
    writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
    try {
      if (exclusive) linkSync(temporary, destination);
      else {
        try {
          checkFile(lstatSync(destination), true);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        renameSync(temporary, destination);
      }
    } finally {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  function secret(name) {
    // A complete value is linked into place atomically; concurrent creators read
    // the winner rather than overwriting it or observing a partly written value.
    try {
      publish(name, randomBytes(32).toString('hex'), true);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const value = read(name, 'utf8');
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid automation cron secret.');
    return value;
  }
  return { path: artifactPath, read, write: publish, secret };
}

// Lazy initialization keeps importing this module free of filesystem mutations.
export const readAutomationArtifact = (name, encoding) =>
  automationArtifacts().read(name, encoding);
export const writeAutomationArtifact = (name, data) => automationArtifacts().write(name, data);
export const automationSecret = (name) => automationArtifacts().secret(name);
