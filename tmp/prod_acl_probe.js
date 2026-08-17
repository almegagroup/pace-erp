const { Client } = require("pg");

async function main() {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || "5432"),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || "postgres",
    options: process.env.PGOPTIONS || undefined,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const sql = process.argv[2];
  if (!sql) {
    throw new Error("SQL argument required");
  }
  const res = await client.query(sql);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
