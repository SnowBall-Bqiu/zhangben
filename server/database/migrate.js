const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.js'))
    .sort();

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id)
  );
  const markApplied = db.prepare('INSERT INTO schema_migrations (id) VALUES (?)');

  for (const file of files) {
    const migration = require(path.join(MIGRATIONS_DIR, file));
    const id = migration.id || file.replace(/\.js$/, '');
    if (applied.has(id)) continue;

    db.transaction(() => {
      migration.up(db);
      markApplied.run(id);
    })();

    console.log(`数据库迁移已应用: ${id}`);
  }
}

module.exports = { runMigrations, MIGRATIONS_DIR };
