create policy no_customer_access on private.product_usage_counts for all to authenticated using (false) with check (false);
create policy no_customer_access on private.product_usage_dedup for all to authenticated using (false) with check (false);
