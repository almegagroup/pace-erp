$OUT = "ERP_FULL_DEPENDENCY_GRAPH.txt"

"PACE ERP ARCHITECTURE GRAPH" | Out-File $OUT
"Generated: $(Get-Date)" | Out-File $OUT -Append
"" | Out-File $OUT -Append


# --------------------------------
# FRONTEND → API
# --------------------------------

"========== FRONTEND → API ==========" | Out-File $OUT -Append

Get-ChildItem frontend/src -Recurse -Include *.js,*.jsx |
ForEach-Object {

$matches = Select-String $_.FullName -Pattern "/api/"

if ($matches) {

"FILE: $($_.FullName)" | Out-File $OUT -Append

$matches | ForEach-Object {

"   → $($_.Line.Trim())" | Out-File $OUT -Append

}

}

}

"" | Out-File $OUT -Append



# --------------------------------
# ROUTES → HANDLERS
# --------------------------------

"========== ROUTE → HANDLER ==========" | Out-File $OUT -Append

Get-ChildItem supabase/functions/api/_routes -Recurse -Include *.ts |
ForEach-Object {

$file = $_.FullName

"ROUTE FILE: $file" | Out-File $OUT -Append

$handlers = Select-String $file -Pattern "handler"

$handlers | ForEach-Object {

"   → $($_.Line.Trim())" | Out-File $OUT -Append

}

}

"" | Out-File $OUT -Append



# --------------------------------
# HANDLER → TABLE
# --------------------------------

"========== HANDLER → DB TABLE ==========" | Out-File $OUT -Append

Get-ChildItem supabase/functions -Recurse -Include *.handler.ts |
ForEach-Object {

$file = $_.FullName

$matches = Select-String $file -Pattern "\.from\(|\.select\(|\.insert\(|\.update\("

if ($matches) {

"HANDLER: $file" | Out-File $OUT -Append

$matches | ForEach-Object {

"   → $($_.Line.Trim())" | Out-File $OUT -Append

}

}

}

"" | Out-File $OUT -Append



# --------------------------------
# MIGRATIONS → TABLES
# --------------------------------

"========== MIGRATIONS → TABLE ==========" | Out-File $OUT -Append

Get-ChildItem supabase/migrations -Recurse -Include *.sql |
ForEach-Object {

$file = $_.FullName

$tables = Select-String $file -Pattern "create table"

if ($tables) {

"MIGRATION: $file" | Out-File $OUT -Append

$tables | ForEach-Object {

"   → $($_.Line.Trim())" | Out-File $OUT -Append

}

}

}

Write-Host "ERP dependency graph generated."