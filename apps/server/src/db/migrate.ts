import { parseEnvironment } from '../env.js';
import { createDatabase } from './database.js';

const database = createDatabase(parseEnvironment(process.env).DATABASE_URL);
try {
  await database.migrate();
  console.log('Database migrations applied.');
} catch {
  console.error(
    'Migration failed. Check database connectivity and committed migrations.',
  );
  process.exitCode = 1;
} finally {
  await database.close();
}
