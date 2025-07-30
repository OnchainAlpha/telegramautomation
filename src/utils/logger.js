export const GREEN = "\x1b[32m";
export const RED = "\x1b[31m";
export const BLUE = "\x1b[34m";
export const WHITE = "\x1b[37m";
export const RESET = "\x1b[0m";

export function success(message) {
  console.log(`${GREEN}${message}${RESET}`);
}

export function error(message) {
  console.log(`${RED}${message}${RESET}`);
}

export function info(message) {
  console.log(`${BLUE}${message}${RESET}`);
}

export function updateConsoleTitle(title) {
  if (process.platform === 'win32') {
    process.stdout.write(`\x1B]0;${title}\x07`);
  }
} 