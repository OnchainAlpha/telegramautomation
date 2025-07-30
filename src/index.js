#!/usr/bin/env node
import cli from './cli/index.js';

async function main() {
  try {
    await cli.run();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main(); 