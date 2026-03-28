# ERP Keyboard-First Interaction Standard

Purpose:
This document locks the keyboard-first operating direction
for the protected ERP system.

It does not copy Tally visuals.
It locks the interaction destination:
full keyboard-operated ERP work,
with mouse remaining optional,
not primary.

---

# 1. Operating Intent

Target:
- every important ERP workflow must be executable by keyboard
- mouse may remain available,
  but must never be mandatory for primary work
- focus must stay deterministic
- every screen must expose a usable keyboard path

Meaning:
- navigation must be keyboard reachable
- actions must be keyboard reachable
- form entry must be keyboard reachable
- confirmation overlays must be keyboard reachable
- protected session features must remain intact

Non-negotiable compatibility:
- idle warning stays
- idle logout stays
- absolute warning stays
- absolute logout stays
- workspace lock stays
- governed max-3 window cluster stays
- logout confirmation stays
- route guard stays
- menu snapshot authority stays

Keyboard-first is an addition layer,
not a replacement of existing governance or security.

---

# 2. Core Rules

## 2.1 Focus Is Law

- every screen must have a clear primary focus target
- focus must never disappear into the page body
- overlays must trap focus deterministically
- closing an overlay must return focus safely

## 2.2 Same Meaning Everywhere

- the same shortcut must keep the same job everywhere
- `Esc` must remain back / close / cancel oriented
- `Ctrl+K` opens the ERP command bar
- `Alt+H` returns to home
- `Alt+M` focuses menu
- `Alt+A` focuses top actions
- `Alt+C` focuses current work area
- `Alt+L` locks workspace
- `Ctrl+Shift+L` opens logout confirmation

## 2.3 Screen Actions Must Be Discoverable

- every important screen must register its own commands
- screen-specific actions must appear inside the ERP command bar
- save, create, lookup, open picker, and jump-to-section actions
  must be reachable without mouse travel

## 2.4 Reserved Browser Shortcuts Must Be Avoided

- do not depend on browser-reserved shortcuts
- if a shortcut is fragile across browsers,
  remove it instead of forcing it
- critical ERP actions must always have
  a fallback via command bar or deterministic focus path

---

# 3. Command Bar Standard

The protected ERP shell must expose one keyboard command center.

Current baseline:
- `Ctrl+K` opens the command bar
- `Ctrl+S` triggers the registered screen save action when available
- `Alt+R` triggers the registered screen refresh action when available
- `Alt+Shift+F` focuses the registered screen search/filter target when available
- `Alt+Shift+P` focuses the registered primary target when available
- command bar must include:
  - shell actions
  - current-screen actions
  - allowed navigation targets
- Arrow Up / Down moves the highlight
- `Enter` executes
- `Esc` closes

Why:
- this gives power users one universal keyboard doorway
- it reduces mouse hunting
- it keeps future screens consistent

---

# 4. Screen Build Rules

Every new protected screen should follow this order:

1. define primary focus target
2. define top action buttons
3. define screen command registration
4. define roving focus for lists or action rows
5. define save / confirm / cancel keyboard flow
6. verify no existing protected-session behavior regressed

Recommended screen command examples:
- save current record
- create new record
- open picker
- focus first filter
- jump to next working section
- go to related governance screen

---

# 5. Rollout Direction

This rollout should happen in layers.

Layer 1:
- protected shell command bar
- shell-wide focus and action consistency

Layer 2:
- SA governance screens
- org masters
- user role and scope screens

Layer 3:
- HR and business data-entry modules
- approval inbox and workflow surfaces
- dense report/filter/tally screens

---

# 6. First Implemented Foundation

Date:
2026-03-28

Implemented now:
- protected-shell command bar foundation
- route-level screen command registry
- route-level screen hotkey registry
- shell command exposure in command bar
- allowed menu-route exposure in command bar
- first screen-level commands on:
  - SA Company Create
  - SA User Scope

This is the first keyboard-first foundation layer.
Future screens must extend this pattern,
not invent separate keyboard behavior.
