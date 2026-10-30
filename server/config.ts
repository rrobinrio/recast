import dotenv from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const envPath = process.env.RECAST_ENV_PATH || (existsSync(resolve(root, '.env')) ? resolve(root, '.env') : resolve(root, '../../.env'));
dotenv.config({ path: envPath, override: true, quiet: true });
export const dataDir = resolve(process.env.RECAST_DATA_DIR || resolve(root, 'data'));
mkdirSync(resolve(dataDir, 'media'), {recursive:true});
const secretPath = resolve(dataDir, 'signing-secret');
if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(48).toString('hex'), {mode:0o600, flag:'wx'});
export const signingSecret = readFileSync(secretPath, 'utf8');
export const origin = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
export function mediaBaseUrl() {
  const configured = process.env.PUBLIC_MEDIA_BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
  const localAddress = resolve(dataDir, 'tunnel', 'address.txt');
  if ((!configured || configured.includes('.trycloudflare.com')) && existsSync(localAddress))
    return readFileSync(localAddress, 'utf8').trim();
  return configured;
}
export function comfyKey() {
  // A key present only in the shell never enables live generation.
  if (!existsSync(envPath)) return '';
  return (dotenv.parse(readFileSync(envPath)).COMFY_API_KEY || '').trim();
}
