-- Three fixed primary roles: system_admin, school_admin, community.
-- ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it, so
-- the new label is added here and used by 0011.
alter type public.app_role add value if not exists 'community';
