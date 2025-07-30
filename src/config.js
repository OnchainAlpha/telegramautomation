import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ACCOUNTS_DIR = path.join(__dirname, '..', 'accounts');
export const GROUPS_DATA_DIR = path.join(__dirname, '..', 'groups_data');
export const CACHE_DIR = path.join(__dirname, '..', 'cache');

// Add other constants as needed 