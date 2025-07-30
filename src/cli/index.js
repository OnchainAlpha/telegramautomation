import prompts from './prompts.js';
import { success, error, info } from '../utils/logger.js';
import { manageAccounts } from '../commands/manageAccounts.js';
import { forwardMessages } from '../commands/forwardMessages.js';
import { joinGroups } from '../commands/joinGroups.js';

export default {
  async run() {
    while (true) {
      console.clear();
      info('=== MAIN MENU ===');
      console.log('1. Manage Accounts');
      console.log('2. Forward Messages');
      console.log('3. Join Groups');
      console.log('4. Exit');

      const choice = await prompts.text('Select an option (1-4): ');
      switch (choice) {
        case '1':
          await manageAccounts();
          break;
        case '2':
          await forwardMessages();
          break;
        case '3':
          await joinGroups();
          break;
        case '4':
          success('Goodbye!');
          process.exit(0);
        default:
          error('Invalid option.');
          break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
}; 