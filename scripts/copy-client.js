#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const clientBuildDir = join(rootDir, 'client', 'dist');
const serverBuildDir = join(rootDir, 'server', 'dist');
const distDir = join(rootDir, 'dist');
const distClientDir = join(distDir, 'client');
const distServerDir = join(distDir, 'server');

console.log('📦 Copying build artifacts to dist folder...');

// Check if client build exists
if (!existsSync(clientBuildDir)) {
  console.error('❌ Client build not found. Run "npm run build:client" first.');
  process.exit(1);
}

// Check if server build exists
if (!existsSync(serverBuildDir)) {
  console.error('❌ Server build not found. Run "npm run build:server" first.');
  process.exit(1);
}

// Create dist directory
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// Clean existing dist/client and dist/server
if (existsSync(distClientDir)) {
  rmSync(distClientDir, { recursive: true });
}
if (existsSync(distServerDir)) {
  rmSync(distServerDir, { recursive: true });
}

// Copy client build
console.log('  Copying client build...');
cpSync(clientBuildDir, distClientDir, { recursive: true });

// Copy server build
console.log('  Copying server build...');
cpSync(serverBuildDir, distServerDir, { recursive: true });

console.log('✅ Build artifacts copied successfully!');
console.log(`   Client: ${distClientDir}`);
console.log(`   Server: ${distServerDir}`);
