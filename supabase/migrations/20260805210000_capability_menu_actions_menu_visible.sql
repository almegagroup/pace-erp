-- Section 30 (ACL_SSOT.md) — Page Visibility vs Data Access Separation.
-- Adds the menu_visible flag to both the live and version-captured capability
-- grant tables. Default true on both means zero behavior change for every
-- existing row: today's ALLOW+VIEW-implies-page-visible behavior is preserved
-- exactly until a future grant deliberately sets menu_visible=false.

ALTER TABLE acl.capability_menu_actions
  ADD COLUMN menu_visible boolean NOT NULL DEFAULT true;

ALTER TABLE acl.version_capability_menu_actions
  ADD COLUMN menu_visible boolean NOT NULL DEFAULT true;
