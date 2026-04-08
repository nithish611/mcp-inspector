import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface PersonaEmailEntry {
  email: string;
  lastUsed: number;
  serverIds: string[];
}

interface PersonaCacheFile {
  emails: PersonaEmailEntry[];
}

const CACHE_DIR = join(homedir(), '.mcp-client');
const CACHE_FILE = join(CACHE_DIR, 'persona-emails.json');

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function readCache(): PersonaCacheFile {
  try {
    ensureCacheDir();
    if (!existsSync(CACHE_FILE)) {
      return { emails: [] };
    }
    const raw = readFileSync(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as PersonaCacheFile;
    if (!Array.isArray(parsed.emails)) {
      return { emails: [] };
    }
    return parsed;
  } catch {
    return { emails: [] };
  }
}

function writeCache(cache: PersonaCacheFile): void {
  ensureCacheDir();
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

export function savePersonaEmail(email: string, serverId: string): void {
  const cache = readCache();
  const normalized = email.toLowerCase().trim();
  const existing = cache.emails.find(e => e.email.toLowerCase() === normalized);

  if (existing) {
    existing.lastUsed = Date.now();
    existing.email = email.trim();
    if (!existing.serverIds.includes(serverId)) {
      existing.serverIds.push(serverId);
    }
  } else {
    cache.emails.push({
      email: email.trim(),
      lastUsed: Date.now(),
      serverIds: [serverId],
    });
  }

  writeCache(cache);
}

export function getPersonaEmails(serverId?: string): PersonaEmailEntry[] {
  const cache = readCache();
  let entries = cache.emails;

  if (serverId) {
    entries = entries.filter(e => e.serverIds.includes(serverId));
  }

  return entries.sort((a, b) => b.lastUsed - a.lastUsed);
}

export function removePersonaEmail(email: string): boolean {
  const cache = readCache();
  const normalized = email.toLowerCase().trim();
  const before = cache.emails.length;
  cache.emails = cache.emails.filter(e => e.email.toLowerCase() !== normalized);

  if (cache.emails.length < before) {
    writeCache(cache);
    return true;
  }
  return false;
}
