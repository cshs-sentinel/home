-- Hand the results back as an error so that nothing is ever committed.
reset role;
do $do$
declare v_out text;
begin
  select json_agg(json_build_object('n', n, 'name', name, 'ok', ok, 'detail', detail) order by n)::text into v_out from zz_test.res;
  raise exception 'ZZRESULT%', v_out;
end $do$;
