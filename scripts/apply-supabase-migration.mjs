import fs from 'node:fs/promises'
import postgres from 'postgres'

const { POCKETPLAN_PROJECT_REF, POCKETPLAN_DB_PASSWORD } = process.env
if (!POCKETPLAN_PROJECT_REF || !POCKETPLAN_DB_PASSWORD) {
  throw new Error('Missing PocketPlan database connection variables')
}

const sql = postgres({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  username: `postgres.${POCKETPLAN_PROJECT_REF}`,
  password: POCKETPLAN_DB_PASSWORD,
  ssl: 'require',
  max: 1,
  connect_timeout: 30,
})

try {
  const migration = await fs.readFile(
    new URL('../supabase/migrations/202607200001_initial_schema.sql', import.meta.url),
    'utf8',
  )
  await sql.unsafe(migration)
  console.log('PocketPlan migration applied successfully.')
} finally {
  await sql.end()
}
