-- PARES (Portal de Archivos Españoles): how one of its records is verified.
--
-- The editor approved pares.cultura.gob.es as item_verified (source_policy_decisions #25,
-- rights_class 'mixed'). item_verified means "the host is governed, each ITEM is checked
-- at use" — and which check is a row in source_access_rules naming a verification
-- strategy that code knows how to run. archive.org has one (archive_org_metadata); PARES
-- had none, so the registry resolver refused every PARES record with
-- "unknown verification strategy: none". ingest/pares.py::verify_pares_item is the
-- strategy 'pares_description': the URL must be one specific record page
-- (/ParesBusquedas20/catalogo/description/<id>), the page must be a genuine PARES
-- description carrying its signatura and reference code, and it must state the ministry's
-- reuse terms. It admits the record's DESCRIPTION — not the document's images.
--
-- Idempotent, and keyed on the host rather than a hardcoded endpoint id.

insert into source_access_rules
  (endpoint_id, allowed_hosts, path_patterns, verification_strategy, expected_redirect_hosts)
select e.id,
       array['pares.cultura.gob.es'],
       array['^/ParesBusquedas20/catalogo/description/[0-9]{1,12}/?$'],
       'pares_description',
       array[]::text[]
from source_endpoints e
where e.host_pattern = 'pares.cultura.gob.es'
  and e.match_type = 'exact'
  and not exists (select 1 from source_access_rules r where r.endpoint_id = e.id);
