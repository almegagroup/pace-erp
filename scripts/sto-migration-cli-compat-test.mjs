// Supabase CLI v2.75.0 pkg/parser/state.go mistakes unquoted identifier
// substrings ATOMIC for BEGIN ATOMIC. Quoted lowercase names keep the same
// PostgreSQL identity while avoiding that parser state.
// https://github.com/supabase/cli/issues/5020
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function unquotedAtomic(sql) {
  // Remove lexical regions the CLI skips before searching ReadyState text.
  const outside = sql.replace(
    /\$(?:[A-Za-z_][\w]*)?\$[\s\S]*?\$(?:[A-Za-z_][\w]*)?\$|--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"/g,
    ' ',
  );
  return /\b\w*atomic\w*\b/i.test(outside);
}

assert.equal(unquotedAtomic('CREATE FUNCTION erp_procurement.create_sto_atomic() RETURNS void AS $$ BEGIN NULL; END; $$; SELECT 1;'), true);
assert.equal(unquotedAtomic('CREATE FUNCTION erp_procurement."create_sto_atomic"() RETURNS void AS $$ BEGIN NULL; END; $$; SELECT 1;'), false);
const files = [
  '20260911112001_sto_sending_workflow_atomic.sql',
  '20260911112900_sto_sending_workflow_lifecycle_guards.sql',
  '20260911113237_sto_invoice_reservation_compatibility.sql',
];
for (const file of files) {
  const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
  assert.equal(unquotedAtomic(sql), false, `${file}: quote identifiers containing atomic for CLI 2.75.0`);
  assert.equal(/END\s+\$fn\$;/.test(sql), false, `${file}: use END; before the closing dollar quote`);
}
console.log('PASS: all three STO migrations avoid the pinned CLI atomic-identifier parser bug');
