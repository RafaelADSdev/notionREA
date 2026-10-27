-- Retain receipts while a source exists; do not cascade away authorization evidence.
-- A complete workspace deletion removes pages/files/databases and its jobs/items
-- through separate cascade paths. Validate these NO ACTION metadata links only
-- after the transaction finishes, when every cascade path has completed.
alter table public.interchange_jobs
  alter constraint interchange_jobs_root_page_id_workspace_id_fkey deferrable initially deferred,
  alter constraint interchange_jobs_parent_id_workspace_id_fkey deferrable initially deferred;

alter table public.interchange_items
  alter constraint interchange_items_page_id_workspace_id_fkey deferrable initially deferred,
  alter constraint interchange_items_source_page_id_workspace_id_fkey deferrable initially deferred,
  alter constraint interchange_items_database_id_workspace_id_fkey deferrable initially deferred,
  alter constraint interchange_items_file_id_fkey deferrable initially deferred;
