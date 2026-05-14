import { DataSource } from 'typeorm';
import { AppDataSource } from '../config/database';

let _connection: DataSource | null = null;

/**
 * Returns an initialized TypeORM DataSource.
 * Reuses the existing connection on Lambda warm invocations.
 */
async function getDatabaseConnection(): Promise<DataSource> {
  if (_connection !== null && _connection.isInitialized) {
    return _connection;
  }

  _connection = AppDataSource;

  if (!_connection.isInitialized) {
    await _connection.initialize();
  }

  return _connection;
}

export { getDatabaseConnection };
