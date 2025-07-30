import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';
import { success, error } from '../utils/logger.js';

export async function connectClient({ apiId, apiHash, sessionString, phoneNumber }) {
  const stringSession = new StringSession(sessionString);
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: false,
    timeout: 60000,
    retryDelay: 2000,
  });
  try {
    await client.connect();
    success(`Connected as ${phoneNumber}`);
    return client;
  } catch (err) {
    error(`Connection error for ${phoneNumber}: ${err.message}`);
    throw err;
  }
} 