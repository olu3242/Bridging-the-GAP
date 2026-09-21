-- Pin search_path on the curriculum visual immutability trigger.
-- Security hardening required by the canonical function linter.

alter function btg.guard_visual_asset_content()
  set search_path = pg_catalog, pg_temp;