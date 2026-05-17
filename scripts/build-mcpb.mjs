#!/usr/bin/env node

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Dynamically import the required ESM classes from archiver
const { ZipArchive } = await import('archiver');

/**
 * Resolve project paths
 */
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const packageJson = JSON.parse(
  await fs.readFile(
    path.join(rootDir, 'package.json'),
    'utf8'
  )
);

const distDir = path.join(rootDir, 'dist');

const stagingDir = path.join(
  distDir,
  packageJson.name
);

const outputFile = path.join(
  distDir,
  `${packageJson.name}-${packageJson.version}.mcpb`
);

/**
 * Cleanup old artifacts
 */
await fs.rm(stagingDir, {
  recursive: true,
  force: true,
});

await fs.rm(outputFile, {
  force: true,
});

/**
 * Create staging folders
 */
await fs.mkdir(
  path.join(stagingDir, 'server'),
  { recursive: true }
);

await fs.mkdir(
  path.join(stagingDir, 'scripts'),
  { recursive: true }
);

await fs.mkdir(
  path.join(stagingDir, 'srcs'),
  { recursive: true }
);

/**
 * Copy required files
 */
await copyFile('manifest.json', 'manifest.json');
await copyFile('proxy.mjs', 'proxy.mjs');
await copyFile('README.md', 'README.md');
await copyFile('package.json', 'package.json');
await copyFile('start.sh', 'start.sh');

await copyFile(
  'server/index.mjs',
  'server/index.mjs'
);

await copyFile(
  'scripts/ensure-node.sh',
  'scripts/ensure-node.sh'
);

await copyFile(
  'scripts/install-launch-agent.mjs',
  'scripts/install-launch-agent.mjs'
);

await copyFile(
  'scripts/run-launch-agent.sh',
  'scripts/run-launch-agent.sh'
);

await copyFile(
  'scripts/uninstall-launch-agent.mjs',
  'scripts/uninstall-launch-agent.mjs'
);

await copyFile(
  'srcs/claude-developer-mode.png',
  'srcs/claude-developer-mode.png'
);

/**
 * Create MCPB archive
 */
await zipDirectory(stagingDir, outputFile);

console.log('\nBuild complete!');
console.log(outputFile);

/**
 * Copy helper
 */
async function copyFile(from, to) {
  const source = path.join(rootDir, from);
  const destination = path.join(stagingDir, to);

  await fs.copyFile(source, destination);
}

/**
 * Zip helper
 */
async function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(outPath);

    // Create a new ZipArchive instance with the desired options
    const archive = new ZipArchive({
      zlib: {
        level: 9,
      },
    });

    output.on('close', () => {
      console.log(
        `Archive created successfully (${archive.pointer()} bytes)`
      );
      resolve();
    });

    output.on('error', (err) => {
      reject(err);
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn(err);
      } else {
        reject(err);
      }
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    /**
     * false means:
     * include contents of sourceDir
     * without nesting sourceDir itself
     */
    archive.directory(sourceDir, false);

    archive.finalize();
  });
}