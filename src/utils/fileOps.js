import fs from 'fs/promises';

export async function readJson(filePath) {
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

export async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
} 