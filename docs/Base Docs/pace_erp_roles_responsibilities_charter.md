# 📜 PACE‑ERP — Roles, Responsibilities & Working Contract
**Status: FINAL · LOCKED · SINGLE SOURCE OF TRUTH**

এই ডকুমেন্টটি লেখা হয়েছে একটাই কারণে—
যাতে ভবিষ্যতে **কখনোই কে কী করবে, কে কী বোঝার দায়ে, কোনটা কার ভুল—এই ধরনের সমস্যা আর না হয়।**

এই ডকুমেন্ট = আমাদের দুজনের মধ্যে একটি *Working Contract*।

---

## 1️⃣ প্রকল্পে কারা আছেন

### 👤 YOU (Project Owner)
- আপনি ERP‑র **Business Owner ও Final Decision Authority**
- আপনি code লেখেন না
- আপনি system design বা wiring বোঝার দায়ে নন

### 🤖 ME (AI System Architect & Builder)
- আমি **System Architect + Builder + Planner**
- আমি code, structure, dependency, wiring—সব কিছুর দায়িত্বে
- আমি continuity ও correctness নিশ্চিত করার দায়ে

---

## 2️⃣ YOUR RESPONSIBILITIES (আপনার দায়িত্ব)

আপনি যা **করবেন**:

### ✅ 2.1 সিদ্ধান্ত দেওয়া
- Business flow
- ERP behaviour
- "এটা চাই / এটা চাই না"

### ✅ 2.2 STATE FILE ধরে কাজ করা
- `PACE_ERP_STATE.md` দেখবেন
- সেখানে লেখা অনুযায়ী চলবেন

### ✅ 2.3 File presence check করা
আপনার একমাত্র technical check:
- ফাইল আছে কি না
- নাম ঠিক আছে কি না

> ❗ ভিতরের code বোঝা আপনার কাজ নয়

### ✅ 2.4 Freeze approve করা
- Gate freeze হলে বলবেন: **"OK freeze"**

---

## 3️⃣ YOUR NON‑RESPONSIBILITIES (যা আপনার কাজ নয়)

আপনি **কখনোই করবেন না**:

❌ কোন file কিভাবে connect হচ্ছে বোঝার চেষ্টা
❌ Dependency resolve করা
❌ Half‑done কেন half‑done বুঝতে চেষ্টা
❌ Chat history মনে রাখার চেষ্টা
❌ "আর কী বাকি আছে" নিজে আন্দাজ করা

> এগুলো করলে ভুল হবেই—এটা আপনার fault নয়

---

## 4️⃣ MY RESPONSIBILITIES (আমার দায়িত্ব)

আমি যা **করতে বাধ্য**:

### 🔧 4.1 Full system planning
- Gate‑wise plan
- ID‑wise completion logic

### 🔧 4.2 Exact file delivery
প্রতিটা step‑এ:
- Exact file name
- Exact folder path
- Exact content

### 🔧 4.3 Dependency visibility
আমি অবশ্যই জানাবো:
- এই ID complete করতে কোন file দরকার
- কোনটা নেই
- কোন Gate‑এ complete হবে

### 🔧 4.4 STATE FILE maintain করা
- Single source of truth
- Chat‑independent continuity

### 🔧 4.5 No surprise rule
আমি **কখনোই**:
- নতুন completeness level
- নতুন rule
- নতুন dependency

— এগুলো introduce করবো না

---

## 5️⃣ MY NON‑RESPONSIBILITIES (যা আমার কাজ নয়)

আমি **করবো না**:

❌ আপনার হয়ে business decision নেওয়া
❌ আপনার কথা না শুনে design বদলানো
❌ Chat‑এ কিছু বলে document‑এ না লেখা
❌ Half‑done explanation ছাড়া কিছু রাখা

---

## 6️⃣ STATUS শব্দগুলোর স্থায়ী মানে

| Status | মানে |
|------|-----|
| ✅ DONE | পুরো শেষ |
| 🟡 HALF‑DONE | File আছে, wiring / dependency বাকি |
| ⏸ DEFERRED | ইচ্ছা করে পরে করা হবে |
| 🔒 FROZEN | আর কখনো touch করা যাবে না |

> 🔒 FROZEN মানে system complete না—layer complete

---

## 7️⃣ HALF‑DONE গ্রহণের শর্ত

HALF‑DONE **তখনই valid**, যদি STATE FILE‑এ লেখা থাকে:
1. কেন half‑done
2. কী missing
3. কোন Gate + ID‑তে complete হবে

না থাকলে = INVALID

---

## 8️⃣ New Chat Continuity Rule

নতুন chat শুরু হলে আপনি করবেন:
1. `PACE_ERP_STATE.md` paste
2. লিখবেন: **"Continue from this state"**

এর বেশি কিছু লাগবে না

---

## 9️⃣ Conflict Resolution Rule

কোনো confusion হলে priority order:

1️⃣ This document
2️⃣ STATE FILE
3️⃣ Gate freeze documents
4️⃣ Chat (last)

---

## 🔒 FINAL LOCK DECLARATION

এই ডকুমেন্ট:
- আজ থেকে immutable
- দুজনের জন্য binding
- ERP শেষ না হওয়া পর্যন্ত valid

---

## ✍️ Confirmation (Required)

লিখুন:

**"I approve this Roles & Responsibilities document"**

তারপর আমি পরের ধাপে যাবো—
`PACE_ERP_STATE.md` generate করবো।


---

## ERP State File (Single Source of Continuity) — Final Decision

### 1. Purpose (Why this file exists)
This file exists to **eliminate dependency on chat memory** and prevent loss of context across sessions.

It is the **only authoritative operational state** of the ERP build.

If a question arises like:
- "eta ki complete hoyeche?"
- "eta half-done keno?"
- "eta kothay complete hobe?"

👉 The answer **must exist in this file**.

No new explanation, no reinterpretation, no guesswork.

---

### 2. File Name (Locked)

**`PACE_ERP_STATE.md`**

This name is FINAL.
No variants, no versions, no alternatives.

---

### 3. File Location (Locked)

```
/docs/
  ├── SSOT.md
  ├── GATE_0_FREEZE.md
  ├── GATE_1_FREEZE.md
  ├── GATE_2_AUTH_BOUNDARY.md
  └── PACE_ERP_STATE.md   ← SINGLE LIVE STATE FILE
```

Only this file represents **current reality**.

---

### 4. Structure of PACE_ERP_STATE.md (Mandatory)

Each row MUST have these columns (no exception):

| Status | Gate | ID | Domain | Short_Name | Current_Reality | Why_Not_Complete | Completes_In_Gate | Completes_On_or_After_ID | Files_Involved |

---

### 5. Status Vocabulary (Frozen)

Only these values are allowed:

- ✅ **DONE**  
  Fully implemented, wired, tested. No pending dependency.

- 🟡 **HALF-DONE**  
  Code exists but **cannot function fully yet** due to missing dependency.

- ⏸ **DEFERRED**  
  Intentionally skipped. No code expected yet.

- 🔒 **FROZEN**  
  Logic + contract locked. No further change allowed.

No new status words will EVER be introduced.

---

### 6. Meaning of HALF-DONE (Critical Rule)

HALF-DONE is allowed **only if all 3 are written**:

1. **Why_Not_Complete**  
   (Exact missing piece — file / table / invariant)

2. **Completes_In_Gate**  
   (Example: Gate-2, Gate-3)

3. **Completes_On_or_After_ID**  
   (Exact ID, not vague)

If any of the above is missing → status is INVALID.

---

### 7. No Hidden Completion Rule

A HALF-DONE item:
- ❌ Will NOT silently complete later
- ❌ Will NOT be auto-assumed done

It completes **only when**:
- The mentioned Gate + ID is executed
- And the row is manually updated to DONE

---

### 8. File-Level Mapping (Mandatory for Auth / Session)

For AUTH / SESSION related IDs, this subsection MUST exist:

```
### Files Involved
- supabase/functions/api/_core/auth/login.handler.ts
- supabase/functions/api/_core/auth/authDelegate.ts
- supabase/functions/api/_core/session/session.create.ts
- supabase/functions/api/_core/session/session.types.ts
- SQL: erp.sessions (table)
```

If any listed file/table does not exist → status cannot be DONE.

---

### 9. Update Discipline (Binding)

- Only after an ID discussion finishes, the state file is updated
- No bulk guessing
- No future planning entries

If it is not implemented yet → it stays HALF-DONE or DEFERRED

---

### 10. Chat Reset Safety Rule

If a new chat starts:

1. First instruction: "Refer to PACE_ERP_STATE.md"
2. No reconstruction from memory
3. No reinterpretation

The file overrides all chats.

---

### 11. Responsibility Split (Reaffirmed)

- **You** maintain:
  - Repo
  - File placement
  - Copy–paste exactly as provided

- **I** maintain:
  - Correct wiring logic
  - State accuracy
  - No surprise dependencies

If something breaks due to missing state entry → it is MY fault.

---

### 12. Final Lock

This structure is FINAL.

Any change requires:
- Explicit discussion
- Explicit agreement
- Explicit update in this document

No silent evolution is allowed.


---

## ERP Build Checklist System (Decision Record)

### Why this checklist exists
এই checklist তৈরি করা হয়েছে যাতে:
- কোনো Gate বা ID **আধা অবস্থায় ভুলে যাওয়া না হয়**
- Chat reset হলেও কাজের continuity না ভাঙে
- আপনি (non-coder) নিজেই বুঝতে পারেন: এখন কী বাকি, কেন বাকি

Checklist ≠ roadmap
Checklist = **gate pass verification tool**

---

### Checklist Levels

#### 1️⃣ Gate Entry Checklist (Before starting a Gate)
প্রতিটি Gate শুরু করার আগে অবশ্যই যাচাই হবে:
- আগের Gate 🔒 FROZEN আছে কি না
- State file আপডেটেড কি না
- HALF-DONE item-এর completion Gate/ID লেখা আছে কি না

যদি কোনোটা fail করে → Gate শুরু করা যাবে না

---

#### 2️⃣ ID Completion Checklist (Before marking DONE)
কোনো ID কে ✅ DONE বা 🔒 FROZEN করতে হলে বাধ্যতামূলক:
- সব required files present
- Required DB tables exist (name mentioned)
- Wiring complete (handler → pipeline → DB)
- State file-এ file list লেখা আছে

একটা item miss করলে → status থাকবে 🟡 HALF-DONE

---

#### 3️⃣ HALF-DONE Validation Checklist
🟡 HALF-DONE শুধুমাত্র তখনই valid যখন:
- কেন incomplete লেখা আছে
- কোন file / table missing লেখা আছে
- কোন Gate + ID তে complete হবে লেখা আছে

এই ৩টা না থাকলে HALF-DONE invalid

---

#### 4️⃣ Gate Freeze Checklist
কোনো Gate 🔒 FROZEN ঘোষণার আগে:
- Gate-এর সব IDs DONE / valid DEFERRED
- State file updated
- Freeze declaration row present

এই checklist pass না করলে Freeze invalid

---

### Responsibility Lock
- Checklist define ও maintain করবে: **Assistant**
- Checklist verify ও approve করবে: **User**
- Checklist ছাড়া কোনো status change হবে না

---

### Single Rule (Most Important)
যদি ভবিষ্যতে confusion হয়:
👉 **Checklist > Chat memory > Explanation**

Checklist-ই শেষ কথা।
