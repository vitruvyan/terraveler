-- Canonical VPS PostgreSQL. Apply after editorial_mcp_plans.sql.
-- Governed Wikimedia Commons image consultations (the wikimedia_api per-file
-- verification strategy). Commons stays registered with mixed licensing: the
-- authority for one image is its own receipt, which must carry an accepted
-- per-file licence (public domain, CC0, CC BY, CC BY-SA), revision identity and
-- an upload.wikimedia.org original (thumbnails may come from thumb.wikimedia.org).
-- Text-source receipts are unchanged.
begin;

alter table public.editorial_mcp_consultations drop constraint if exists editorial_mcp_consultations_tool_check;
alter table public.editorial_mcp_consultations add constraint editorial_mcp_consultations_tool_check
 check(tool in ('get_wikipedia_outline','fetch_source_text','fetch_commons_image'));

create or replace function public.editorial_record_mcp_consultation(
 p_tool text,p_arguments jsonb,p_response_text text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare body jsonb; rec public.editorial_mcp_consultations; begin
 if p_tool is null or p_tool not in ('get_wikipedia_outline','fetch_source_text','fetch_commons_image')
  or p_arguments is null or jsonb_typeof(p_arguments)<>'object' or octet_length(p_arguments::text)>8192
  or p_response_text is null or octet_length(p_response_text) not between 2 and 1048576
 then raise exception 'invalid MCP consultation'; end if;
 begin body:=p_response_text::jsonb;
 exception when invalid_text_representation then raise exception 'invalid MCP response JSON'; end;
 if jsonb_typeof(body) is distinct from 'object' then raise exception 'source response object required'; end if;
 if p_tool='fetch_commons_image' then
  -- Per-file verification: Commons has mixed licensing, so the receipt must carry
  -- the file's own accepted licence, revision identity and upload.wikimedia.org image.
  if exists(select 1 from jsonb_object_keys(p_arguments) as k where k<>'title')
   or jsonb_typeof(p_arguments->'title') is distinct from 'string'
   or (p_arguments->>'title') !~ '^File:[^#<>|{}\[\]]{1,250}$'
   or body->>'kind' is distinct from 'commons-image'
   or body->>'title' is distinct from p_arguments->>'title'
   or (body->>'page_url') !~ '^https://commons[.]wikimedia[.]org/wiki/File:'
   or (body->>'image_url') !~ '^https://upload[.]wikimedia[.]org/'
   or (body ? 'thumb_url' and body->'thumb_url'<>'null'::jsonb and (body->>'thumb_url') !~ '^https://(upload|thumb)[.]wikimedia[.]org/')
   or (body->>'mime') !~ '^image/(jpeg|png|gif|tiff|webp|svg[+]xml)$'
   or jsonb_typeof(body->'page_id') is distinct from 'number' or (body->>'page_id') !~ '^[1-9][0-9]{0,15}$'
   or jsonb_typeof(body->'revision_id') is distinct from 'number' or (body->>'revision_id') !~ '^[1-9][0-9]{0,15}$'
   or (body->>'sha1') !~ '^[0-9a-f]{40}$'
   or jsonb_typeof(body->'licence') is distinct from 'object'
   or body#>'{licence,usable}' is distinct from 'true'::jsonb
   or body#>>'{licence,class}' is null or body#>>'{licence,class}' not in ('public_domain','cc0','cc_by','cc_by_sa')
  then raise exception 'invalid Commons image response'; end if;
 elsif jsonb_typeof(p_arguments->'url') is distinct from 'string'
  or length(p_arguments->>'url') not between 1 and 2000
  or jsonb_typeof(body->'text') is distinct from 'string' or (body->>'text') !~ '[^[:space:]]'
 then raise exception 'source response text and URL required';
 elsif p_tool='get_wikipedia_outline' then
  if exists(select 1 from jsonb_object_keys(p_arguments) as k where k<>'url')
   or (p_arguments->>'url') !~ '^https://[a-z][a-z0-9-]{1,19}[.]wikipedia[.]org/wiki/[^?#]+$'
   or body->>'requested_url' is distinct from p_arguments->>'url'
   or body->>'kind' is distinct from 'wikipedia-orientation'
   or body->>'purpose' is distinct from 'planning-only'
   or jsonb_typeof(body->'revision_id') is distinct from 'number'
   or (body->>'revision_id') !~ '^[0-9]{1,16}$'
   or jsonb_typeof(body->'sections') is distinct from 'array'
   or jsonb_typeof(body->'text_truncated') is distinct from 'boolean'
   or jsonb_typeof(body->'sections_truncated') is distinct from 'boolean'
   or jsonb_typeof(body->'external_links_truncated') is distinct from 'boolean'
  then raise exception 'invalid orientation response'; end if;
  if (body->>'revision_id')::bigint not between 1 and 9007199254740991
  then raise exception 'invalid orientation revision'; end if;
 else
  if exists(select 1 from jsonb_object_keys(p_arguments) as k where k not in ('url','kind','lang'))
   or jsonb_typeof(p_arguments->'kind') is distinct from 'string'
   or p_arguments->>'kind' not in ('gutenberg','wikipedia','wikisource','archive','pares')
   or body->>'url' is distinct from p_arguments->>'url'
   or body->>'kind' is distinct from p_arguments->>'kind'
   or coalesce(body->'lang','null'::jsonb) is distinct from coalesce(p_arguments->'lang','null'::jsonb)
   or jsonb_typeof(body->'truncated') is distinct from 'boolean'
   or jsonb_typeof(body->'total_length') is distinct from 'number'
  then raise exception 'invalid source response'; end if;
 end if;
 -- Compute the digests from server-supplied snapshot bytes, never caller hashes.
 insert into public.editorial_mcp_consultations(tool,arguments,arguments_sha256,response_text,response,response_sha256)
 values(p_tool,p_arguments,encode(sha256(convert_to(p_arguments::text,'UTF8')),'hex'),
  p_response_text,body,encode(sha256(convert_to(p_response_text,'UTF8')),'hex')) returning * into rec;
 return jsonb_build_object('id',rec.id,'response_sha256',rec.response_sha256,
  'arguments_sha256',rec.arguments_sha256,'created_at',rec.created_at);
end $$;
revoke all on function public.editorial_record_mcp_consultation(text,jsonb,text) from public,terraveler_service;
grant execute on function public.editorial_record_mcp_consultation(text,jsonb,text) to terraveler_service;

notify pgrst,'reload schema';
commit;
