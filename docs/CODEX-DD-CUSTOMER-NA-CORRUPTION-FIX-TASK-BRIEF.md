# Task Brief — Fix "na"-Stripped Text in DD Customers Import (PROD)

## Background

On 2026-09-11, ~1990 dealer rows from an Excel file ("DD Customers.xlsx") were
imported into PROD (`erp_master.customer_master`, `erp_master.customer_address`,
`erp_master.customer_company_map`). Mid-import, a systematic corruption was
discovered **in the source Excel file itself** (not introduced by the import
scripts): every occurrence of the substring `"na"` / `"Na"` / `"NA"` had been
stripped out, case-insensitively, everywhere in the file — including the
column headers themselves (`"Dealer Name"` appeared as `"Dealer me"`,
`"Site Name"` as `"Site me"`).

This is confirmed, not a hypothesis — proof: the raw Excel's header row
literally reads `(' Dealer me ', ' Dealer Address ', 'PinCode ', ' GSTIN ',
'Dealer Town', 'Dealer State', ' Site me ', ' Site Address ', ' Site Town ',
'VDC')`.

### The corruption is destructive/lossy, not a simple substitution

The stripping removes **every** non-overlapping occurrence of "na" in a word,
scanning left-to-right, so a single word can lose it more than once:

- `Krishnanagar` → strip "na" at position 5-6 → `Krish` + `nagar` → strip "na"
  again from `nagar` → `Krish` + `gar` = **`Krishgar`** (confirmed correct
  reconstruction — verified against real geography: this is Krishnanagar,
  Nadia district, WB)
- `Nadia` → strip "Na" → **`dia`**
- `Sonarpur` → strip "na" → **`Sorpur`**
- `Bidhannagar` → strip "na" → **`Bidhan gar`** (space artifact from the
  strip is also present in the source, not something to "fix" separately)
- `Nandakumar` → strip "na" (only the first "na" matches; "ndakumar" has no
  further "na") → **`ndakumar`**
- `Udaynarayanpur` → strip "na" from "narayan" → **`Udayrayanpur`**
  (confirmed — matches a real village in Howrah district, and the corrupted
  form literally appears in the imported data as "UDAYRAYANPUR")
- `Bagnan` → strip "na" → **`Bagn`** (confirmed — real place, Howrah
  district; also confirms most words that *don't* contain "na" survived
  completely unaffected, e.g. "KANCHRAPARA", "MOGRAHAT", "BARUIPUR" — no
  "na" substring in those, so nothing was stripped)

**Because a word can lose "na" more than once, you cannot safely reconstruct
by inserting "na" back exactly once per corrupted token.** The correct
approach is a search: try re-inserting "na" 1, 2, or 3 times at every
possible gap position in the corrupted token, and accept a candidate only if
it produces a real, verifiably-correct word (see algorithm below).

### No clean source exists

The business owner confirmed there is no other copy of this data — the
corrupted Excel is the only source. This is being fixed retroactively against
what's already live in PROD.

## Scope — exactly which data is affected

The corruption only reached the DB through fields that were populated
**directly from the raw Excel** during import. Fields sourced from the
Applyflow GST verification API (for GST-registered dealers) are **clean** —
do not touch them.

Affected (fix these):

1. **`erp_master.customer_address`** — ALL rows imported in this batch
   (~1770 rows, `created_by = 'f21cd7ec-88be-48ff-b4e8-59dca1cbb1c0'`,
   inserted 2026-09-10/11). Columns: `site_name`, `address_line`, `town`.
   This applies to every customer regardless of GST status, since site/address
   data always came straight from the Excel, never from Applyflow.

2. **`erp_master.customer_master`** — only the subset of rows created in this
   same import batch **where `gst_number IS NULL`** (the "blank-GST dealer"
   case — these got `customer_name`/`delivery_address`/`billing_address`
   straight from the Excel's `dealer_name`/`dealer_address`). Rows with a
   non-null `gst_number` got their name/address from the Applyflow API
   response, not the Excel — **do not touch those**, they're already clean.
   You can identify the batch by `customer_code` range `C-00249` through
   `C-01590` combined with `gst_number IS NULL`.

Not affected (do not touch): `state` (values like "West Bengal", "Assam",
"Jharkhand" — none contain "na" as a substring, verified), `pin_code`,
`depot_code_id`, `status`, any other table.

## The fix algorithm

For each of the target text fields above, on the value **currently stored in
PROD** (not the original Excel — work from what's live now):

1. Tokenize on runs of letters (`[A-Za-z]+`), length ≥ 2. Leave everything
   else (spaces, digits, punctuation) untouched — corruption only affects
   letter sequences.
2. For each token, first check whether it already matches a known-good word
   (gazetteer or dictionary, case-insensitive) — if it does, **leave it
   unchanged** (most tokens, including all-caps place names with no "na" in
   them, are already correct and must not be touched).
3. If not, try candidate reconstructions: insert the substring `NA` (matching
   the token's own case — this dataset is mostly uppercase) at every gap
   position (0 through length), producing a length+2 candidate; check each
   against the gazetteer/dictionary. If none match, take each of those
   candidates and try inserting `NA` again at every gap position (second
   insertion), check again. Repeat for a third insertion. Cap at 3 total
   insertions — real West Bengal place names never lost more than 2 "na"s
   found so far (Krishnanagar lost 2; nothing found so far lost 3).
4. **If exactly one candidate at the lowest insertion-count matches a
   known-good word, accept it.** If the search produces more than one
   equally-plausible match, or produces zero matches even after 3 insertions,
   **leave the token exactly as-is and log it as unresolved** — do not
   guess. Getting this wrong is worse than leaving it corrupted (see the
   Krishnagar-vs-Krishnanagar mistake below — always verify a reconstruction
   against a real gazetteer entry, never just "add na and see if it looks
   plausible").

   **Real mistake made earlier in this task, learn from it:** an early guess
   assumed `Krishgar` → `Krishnagar` (only one "na" re-inserted). The
   business owner corrected this — the real place is **Krishnanagar** (two
   "na"s were stripped). This is exactly why the algorithm must search up to
   3 insertions and validate against a real gazetteer, not stop at the first
   plausible-looking single insertion.

5. Reassemble the field with fixed tokens substituted in place of their
   corrupted originals, preserving all original whitespace/punctuation/casing
   structure around them.

### Building the gazetteer

You need a reasonably complete West Bengal place-name list (districts,
blocks, census towns, municipalities, post offices) to validate candidates
against. Try, in order:
- A real India PIN-code / post-office open dataset (India Post publishes one;
  data.gov.in mirrors exist; search for one that's actually fetchable — two
  guessed GitHub repo paths were already tried and 404'd during this task,
  don't repeat those specific URLs, find a working source or generate one
  from local knowledge)
- If no dataset is fetchable, hand-build a gazetteer from West Bengal's
  official administrative list (all districts, and as many blocks/towns as
  you can enumerate) — a few hundred to a couple thousand entries is fine,
  it doesn't need to be exhaustive, it needs to cover common dealer/site
  town names in this specific dataset (Nadia, Murshidabad, Bardhaman/
  Burdwan, Birbhum, Bankura, Purulia, Howrah, Hooghly, North/South 24
  Parganas, Malda, Uttar/Dakshin Dinajpur, Purba/Paschim Medinipur, Kolkata
  neighborhoods, Jhargram — these districts account for the large majority
  of rows).
- Seed the gazetteer explicitly with the confirmed examples above
  (Krishnanagar, Nadia, Sonarpur, Bidhannagar, Nandakumar, Udaynarayanpur,
  Bagnan) so those are guaranteed to be found.

For the general-English-word fallback (business/structural words like
"Road", "Market", "Complex", "Station", "Enterprise", "Hardware" — these
don't need "na" reinsertion unless they happen to contain it, e.g. none of
these examples do, but some might), a standard English word list is fine —
one is already downloaded in this repo's scratch history if you want a
starting point, or fetch a fresh one (e.g. `dwyl/english-words` on GitHub,
`words_alpha.txt`).

**Do not blindly trust an "unrecognized against dictionary" count as a scope
signal** — a prior pass in this same task found 2883 "unrecognized" tokens
out of 3686 total, but the overwhelming majority of those are just Indian
proper nouns (place names, personal names) that were never going to be in
an English dictionary regardless of corruption. The gazetteer is what
actually narrows this down to real corruption candidates.

## Required workflow — dry run before any PROD write

1. **First pass: report only, no writes.** Query the affected PROD rows,
   run the algorithm, and produce a full CSV/JSON report: for every field
   where at least one token changed, show `row id | column | original value
   | proposed fixed value`. Also produce a separate list of every token that
   was flagged as unresolved (ambiguous or unmatched), grouped by frequency,
   so it can be spot-reviewed.
2. **Show that report before writing anything.** Do not apply any UPDATE
   until the dry-run report has been reviewed (by the user or by Claude in
   this same conversation thread — ask if unsure).
3. **Second pass: apply.** Once approved, apply the fixes as UPDATE
   statements, ideally batched with `write_db`/direct SQL, on **PROD project
   `bsjpvkigpllichlknmah`** (this dataset was only ever imported into PROD,
   not dev — dev has no DD Customers data to fix).
4. **Verify after applying**, using your own Supabase access:
   - Re-query a random sample (~30-50 rows) of changed rows and confirm the
     new text looks correct.
   - Confirm row counts are unchanged (this must be a text UPDATE only —
     never DELETE or INSERT any row, never change `id`, `customer_id`,
     `depot_code_id`, `status`, or any non-text column).
   - Produce a final summary: total rows touched, total tokens fixed, total
     tokens left unresolved (with the unresolved list attached for manual
     follow-up later — it's fine for some entries to stay unfixable, just
     make that list visible rather than silently dropping it).

## Safety rules (non-negotiable)

- This is live PROD customer master data used by the business daily — treat
  every write as high-stakes.
- Never touch any row outside the exact scope defined above (this specific
  import batch, these specific columns).
- Never apply a fix you're not confident in — an unresolved/left-corrupted
  token is a strictly better outcome than a wrong "fix" that silently
  replaces one bad value with a different bad value.
- If you hit ambiguity you can't resolve algorithmically (e.g. a
  free-text dealer/business name where multiple reconstructions are
  equally plausible, or a personal name with no gazetteer/dictionary
  hit at all), leave it as-is and log it — do not guess, do not ask the
  business owner to manually pre-approve individual tokens (that doesn't
  scale to ~1770 rows), just make the "still corrupted, needs eyes"
  list clearly visible in your final report.
