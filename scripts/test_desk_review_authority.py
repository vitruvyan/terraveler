"""The Curator judges sources by the registry unless told otherwise.

    python3 -m unittest test_desk_review_authority -v          (from scripts/)

No database: this only pins what desk_review.configure_source_authority puts
in the environment, because that is the whole of how the Curator's licence
gate (ingest/whitelist.py::resolve_source_authority) learns which authority
to consult and how to reach it.
"""
import os
import unittest

import desk_review

PG = {"host": "127.0.0.1", "port": 6000, "dbname": "terraveler", "user": "terraveler", "password": "s3cret"}
KEYS = ("SOURCE_AUTHORITY_MODE", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD")


class ConfigureSourceAuthority(unittest.TestCase):
    def setUp(self):
        self.saved = {k: os.environ.pop(k, None) for k in KEYS}

    def tearDown(self):
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_defaults_to_the_registry(self):
        desk_review.configure_source_authority(PG)
        self.assertEqual(os.environ["SOURCE_AUTHORITY_MODE"], "registry")

    def test_an_explicit_mode_wins_so_legacy_stays_a_one_line_rollback(self):
        os.environ["SOURCE_AUTHORITY_MODE"] = "legacy"
        desk_review.configure_source_authority(PG)
        self.assertEqual(os.environ["SOURCE_AUTHORITY_MODE"], "legacy")

    def test_offers_the_resolved_connection_to_the_registry_resolver(self):
        desk_review.configure_source_authority(PG)
        self.assertEqual(os.environ["PGPASSWORD"], "s3cret")
        self.assertEqual(os.environ["PGPORT"], "6000")

    def test_never_overrides_a_connection_the_environment_already_names(self):
        os.environ["PGHOST"] = "terraveler_postgres"
        os.environ["PGPORT"] = "5432"
        desk_review.configure_source_authority(PG)
        self.assertEqual(os.environ["PGHOST"], "terraveler_postgres")
        self.assertEqual(os.environ["PGPORT"], "5432")


if __name__ == "__main__":
    unittest.main()
