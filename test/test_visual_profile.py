"""Publication must choose a visual class without asking the page to guess."""
import importlib.util
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "scripts" / "publish_submission.py"
spec = importlib.util.spec_from_file_location("publish_submission", MODULE)
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)


class VisualProfileTests(unittest.TestCase):
    def test_andean_route_never_gets_a_coastal_chart(self):
        voyage = {"ships": "San Cristobal"}
        points = [{"latitude": -4.5, "longitude": -80.5},
                  {"latitude": -7.2, "longitude": -78.5},
                  {"latitude": -12.0, "longitude": -77.0}]
        self.assertEqual(publish.visual_profile(voyage, points), "andes")

    def test_mesoamerica_and_maritime_profiles(self):
        points = [{"latitude": 19.2, "longitude": -96.1},
                  {"latitude": 19.4, "longitude": -98.9}]
        self.assertEqual(publish.visual_profile({"ships": "fleet"}, points), "mesoamerica")
        self.assertEqual(publish.visual_profile({"ships": "Endeavour"}, []), "marine-chart")

    def test_ambiguous_land_and_non_earth_remain_unillustrated(self):
        self.assertEqual(publish.visual_profile({}, []), "unillustrated")
        self.assertEqual(publish.visual_profile({"kind": "surface", "ships": "lander"}, []), "unillustrated")

    def test_new_atlas_entry_carries_profile(self):
        bundle = {"voyage": {"slug": "example-1500", "title": "Example", "start_date": None},
                  "navigator": {"name": "Example"}}
        self.assertIn('visualProfile: "andes"', publish.atlas_entry(bundle, "Example", "andes"))


if __name__ == "__main__":
    unittest.main()
