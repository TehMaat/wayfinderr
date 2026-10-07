import { db } from './services/database.js';
import { resetAccount } from './services/auth.js';

/**
 * Maintenance commands, run inside the backend container:
 *   docker compose exec wayfinderr-backend node dist/cli.js reset-auth
 */
const commands: Record<string, { help: string; run: () => Promise<void> }> = {
  'reset-auth': {
    help: 'Delete the login account (forgotten password): open Wayfinderr and create it again',
    run: async () => {
      await resetAccount();
      console.log('Account deleted and every session signed out.');
      console.log('Open Wayfinderr, then copy the setup code for the new account from the backend log');
      console.log('(docker compose logs wayfinderr-backend).');
    },
  },
};

const main = async () => {
  const command = commands[process.argv[2] ?? ''];
  if (!command) {
    console.log('Usage: node dist/cli.js <command>\n');
    for (const [name, { help }] of Object.entries(commands)) console.log(`  ${name.padEnd(12)} ${help}`);
    process.exitCode = 1;
    return;
  }
  try {
    await command.run();
  } finally {
    await db.disconnect();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
