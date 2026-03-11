# ============================================
# PACE ERP REPO TREE EXPORT
# Generates repository structure snapshot
# ============================================

$OutputFile = "ERP_REPO_TREE.txt"

Write-Host "Generating ERP repository tree..."

"==========================================" | Out-File $OutputFile
"PACE ERP REPOSITORY STRUCTURE" | Out-File $OutputFile -Append
"Generated: $(Get-Date)" | Out-File $OutputFile -Append
"==========================================" | Out-File $OutputFile -Append
"" | Out-File $OutputFile -Append

# -----------------------------
# FRONTEND SRC TREE
# -----------------------------

"FRONTEND /src TREE" | Out-File $OutputFile -Append
"------------------------------------------" | Out-File $OutputFile -Append

tree frontend\src /F /A | Out-File $OutputFile -Append

"" | Out-File $OutputFile -Append
"" | Out-File $OutputFile -Append

# -----------------------------
# SUPABASE FUNCTIONS TREE
# -----------------------------

"SUPABASE FUNCTIONS TREE" | Out-File $OutputFile -Append
"------------------------------------------" | Out-File $OutputFile -Append

tree supabase\functions /F /A | Out-File $OutputFile -Append

"" | Out-File $OutputFile -Append
"" | Out-File $OutputFile -Append

# -----------------------------
# SUPABASE MIGRATIONS TREE
# -----------------------------

"SUPABASE MIGRATIONS TREE" | Out-File $OutputFile -Append
"------------------------------------------" | Out-File $OutputFile -Append

tree supabase\migrations /F /A | Out-File $OutputFile -Append

"" | Out-File $OutputFile -Append

Write-Host "Done."
Write-Host "File generated: ERP_REPO_TREE.txt"