"""Offline Photo editor contract: fake MCP tools and model; no network or database."""
import copy
import json
import unittest

from orchestration.editorial_gateway import GatewayConfig, generate_candidate
from orchestration.editorial_handlers import EvidenceError, production_research
from orchestration.editorial_iconography import iconography

R1 = "00000000-0000-4000-8000-000000000001"
R2 = "00000000-0000-4000-8000-000000000002"


def snapshot(title, year="1591"):
    return {"kind": "commons-image", "title": title, "page_url": "https://commons.wikimedia.org/wiki/" + title.replace(" ", "_"),
            "page_id": 1, "revision_id": 2, "image_url": "https://upload.wikimedia.org/x.jpg", "thumb_url": None,
            "mime": "image/jpeg", "width": 800, "height": 600, "sha1": "a" * 40,
            "licence": {"usable": True, "class": "public_domain", "code": "pd", "short_name": "Public domain", "url": None,
                        "attribution_required": False},
            "artist": "Theodor de Bry", "credit": None, "date_original": year, "date_year": int(year),
            "description": "Engraving of Timucua villagers.", "object_name": None, "restrictions": []}


class Tools:
    def __init__(self, receipts=True):
        self.calls, self.receipts = [], receipts

    def __call__(self, name, args):
        self.calls.append((name, args))
        if name == "search_commons_images":
            return {"candidates": [{"title": "File:De Bry Timucua.jpg", "usable": True},
                                   {"title": "File:Reenactment.jpg", "usable": False},
                                   {"title": "File:Moyne map.jpg", "usable": True}]}
        if args["title"] == "File:Missing.jpg":
            return {"refused": True}
        receipt = {"id": R1 if "Timucua" in args["title"] else R2, "response_sha256": "b" * 64}
        return {**snapshot(args["title"]), "consultation": receipt if self.receipts else None,
                "consultation_status": "recorded" if self.receipts else "disabled"}


def model(selection):
    stages = []

    def generate(task, config):
        stage = task["input"]["iconography_stage"]
        stages.append(stage)
        if stage == "queries":
            return {"candidate": {"queries": ["De Bry Florida 1591", "Timucua engraving"]}}
        assert {c["receipt_id"] for c in task["input"]["image_candidates"]} == {R1, R2}
        assert all("image_url" not in c and "page_url" not in c for c in task["input"]["image_candidates"])
        return {"candidate": copy.deepcopy(selection)}
    generate.stages = stages
    return generate


SELECTION = {"kind": "iconography", "uncertainties": [], "selections": [
    {"receipt_id": R1, "depiction": "period-artwork", "relevance": "Shows Timucua villagers as engraved in 1591.", "caution": None}]}


class IconographyTests(unittest.TestCase):
    def setUp(self):
        self.config = GatewayConfig("http://limen:8080", "virtual-key", "editorial")
        self.task = {"id": 9, "role": "research", "attempt": 1, "topic": {"title": "Cabeza de Vaca"},
                     "input": {"graph_run_id": 4, "work_item": {"id": "images", "specialty": "iconography", "question": "Images?"}},
                     "agent_config": {"agent_key": "photo-editor", "version": 1, "name": "Photo editor", "role": "research",
                                      "model": "local-fixture", "instructions": "Select documented images."}}

    def test_selection_copies_exact_receipt_snapshots_and_only_model_judgment(self):
        tools = Tools()
        generate = model(SELECTION)
        result = iconography(self.task, self.config, call_tool=tools, generator=generate)
        self.assertEqual(generate.stages, ["queries", "selection"])
        self.assertEqual(result["kind"], "iconography")
        self.assertEqual(len(result["images"]), 1)
        image = result["images"][0]
        self.assertEqual(image["snapshot"], snapshot("File:De Bry Timucua.jpg"))
        self.assertEqual(image["receipt_id"], R1)
        self.assertEqual(image["receipt_sha256"], "b" * 64)
        self.assertEqual(set(image), {"receipt_id", "receipt_sha256", "snapshot", "depiction", "relevance", "caution"})
        fetched = [a["title"] for n, a in tools.calls if n == "fetch_commons_image"]
        self.assertEqual(fetched, ["File:De Bry Timucua.jpg", "File:Moyne map.jpg"], "unusable and duplicate candidates are never fetched")
        self.assertNotIn("iconography_stage", self.task["input"])

    def test_fabricated_or_unbounded_selections_fail_closed(self):
        mutations = (
            lambda s: s["selections"][0].update(receipt_id="00000000-0000-4000-8000-000000000099"),
            lambda s: s["selections"][0].update(depiction="eyewitness-photo"),
            lambda s: s["selections"][0].update(relevance='Shows the "real" landing.'),
            lambda s: s["selections"][0].update(image_url="https://example.org/x.jpg"),
            lambda s: s["selections"].append(copy.deepcopy(s["selections"][0])),
            lambda s: s.update(selections=[], uncertainties=[]),
        )
        for mutate in mutations:
            value = copy.deepcopy(SELECTION)
            mutate(value)
            with self.subTest(value=value), self.assertRaises(EvidenceError):
                iconography(self.task, self.config, call_tool=Tools(), generator=model(value))

    def test_fetch_budget_interleaves_queries(self):
        calls = []

        def tools(name, args):
            calls.append((name, args))
            if name == "search_commons_images":
                prefix = "A" if "1591" in args["query"] else "B"
                return {"candidates": [{"title": f"File:{prefix}{i}.jpg", "usable": True} for i in range(10)]}
            return {"refused": True}
        iconography(self.task, self.config, call_tool=tools, generator=model(SELECTION))
        fetched = [a["title"] for n, a in calls if n == "fetch_commons_image"]
        self.assertEqual(fetched[:4], ["File:A0.jpg", "File:B0.jpg", "File:A1.jpg", "File:B1.jpg"])
        self.assertEqual(len(fetched), 12)

    def test_receipts_are_mandatory_and_no_candidates_is_an_explicit_gap(self):
        with self.assertRaises(EvidenceError) as caught:
            iconography(self.task, self.config, call_tool=Tools(receipts=False), generator=model(SELECTION))
        self.assertEqual(str(caught.exception), "editorial-image-receipt-required")
        empty = lambda name, args: {"candidates": []}
        result = iconography(self.task, self.config, call_tool=empty, generator=model(SELECTION))
        self.assertEqual(result["images"], [])
        self.assertTrue(result["uncertainties"])

    def test_gateway_binds_selection_to_receipts_and_rejects_unknown_stage(self):
        calls = []

        def transport(request, timeout):
            calls.append(json.loads(request.data))
            from io import BytesIO
            return BytesIO(b'{"choices":[{"message":{"content":"{}"}}]}')
        task = copy.deepcopy(self.task)
        task["input"].update(iconography_stage="selection", image_candidates=[{"receipt_id": R1}, {"receipt_id": R2}])
        generate_candidate(task, self.config, open_request=transport)
        schema = calls[0]["response_format"]["json_schema"]
        self.assertEqual(schema["name"], "terraveler_editorial_iconography_selection")
        self.assertEqual(schema["schema"]["properties"]["selections"]["items"]["properties"]["receipt_id"], {"enum": [R1, R2]})
        self.assertIn("you cannot see the images", calls[0]["messages"][2]["content"])
        task["input"]["iconography_stage"] = "queries"
        generate_candidate(task, self.config, open_request=transport)
        self.assertEqual(calls[1]["response_format"]["json_schema"]["name"], "terraveler_editorial_iconography_queries")
        task["input"]["iconography_stage"] = "anything"
        with self.assertRaises(Exception):
            generate_candidate(task, self.config, open_request=transport)

    def test_production_routes_iconography_only_for_planned_tasks(self):
        task = copy.deepcopy(self.task)
        task["input"].pop("graph_run_id")
        with self.assertRaises(EvidenceError) as caught:
            production_research(task)
        self.assertEqual(str(caught.exception), "editorial-iconography-requires-plan")


if __name__ == "__main__":
    unittest.main()


from orchestration.editorial_iconography import captions, image_display, research_summary, validate_captions  # noqa: E402
from orchestration.editorial_handlers import reviewer  # noqa: E402


def selected(receipt_id, title, depiction="period-artwork"):
    return {"receipt_id": receipt_id, "receipt_sha256": "b" * 64, "snapshot": snapshot(title), "depiction": depiction,
            "relevance": "Documents the Timucua.", "caution": None}


SELECTION_CONTEXT = {"kind": "iconography", "images": [selected(R1, "File:De Bry Timucua.jpg"), selected(R2, "File:Moyne map.jpg", "period-map")],
                     "uncertainties": []}


class CaptionTests(unittest.TestCase):
    def setUp(self):
        self.config = GatewayConfig("http://limen:8080", "virtual-key", "editorial")
        self.task = {"id": 11, "role": "writer", "attempt": 1, "topic": {"title": "Cabeza de Vaca"},
                     "input": {"graph_run_id": 4, "work_item": {"id": "captions", "specialty": "caption"},
                               "image_selection": copy.deepcopy(SELECTION_CONTEXT)},
                     "agent_config": {"agent_key": "image-text-editor", "version": 1, "name": "Image text editor", "role": "writer",
                                      "model": "local-fixture", "instructions": "Caption from metadata."}}

    def model(self, entries):
        return lambda task, config: {"candidate": {"kind": "draft", "format": "captions", "captions": copy.deepcopy(entries)}}

    def test_captions_follow_selection_order_with_receipt_display_data(self):
        entries = [{"receipt_id": R2, "caption": "Map of Florida by Jacques Le Moyne, engraved in 1591.", "alt_text": "Engraved map of the Florida coast."},
                   {"receipt_id": R1, "caption": "Engraving of Timucua villagers by Theodor de Bry, 1591.", "alt_text": "Engraving of villagers."}]
        result = captions(self.task, self.config, generator=self.model(entries))
        self.assertEqual([c["receipt_id"] for c in result["captions"]], [R1, R2])
        self.assertEqual(result["captions"][0]["image"], image_display(SELECTION_CONTEXT["images"][0]))
        self.assertEqual(result["captions"][1]["image"]["depiction"], "period-map")
        self.assertEqual(result["captions"][0]["image"]["licence"]["class"], "public_domain")
        validate_captions(result, SELECTION_CONTEXT["images"])

    def test_invented_unknown_or_missing_captions_fail_closed(self):
        good = [{"receipt_id": R1, "caption": "Engraving, 1591.", "alt_text": "Engraving."},
                {"receipt_id": R2, "caption": "Map, 1591.", "alt_text": "Map."}]
        mutations = (
            lambda e: e.pop(),
            lambda e: e[0].update(receipt_id="00000000-0000-4000-8000-000000000099"),
            lambda e: e[0].update(caption='The "true" landing.'),
            lambda e: e[0].update(alt_text="x" * 301),
            lambda e: e[0].update(image={"title": "forged"}),
            lambda e: e.append(copy.deepcopy(e[0])),
        )
        for mutate in mutations:
            entries = copy.deepcopy(good)
            mutate(entries)
            with self.subTest(entries=entries), self.assertRaises(EvidenceError):
                captions(self.task, self.config, generator=self.model(entries))

    def test_empty_selection_needs_no_model_call(self):
        self.task["input"]["image_selection"] = {"kind": "iconography", "images": [], "uncertainties": ["None found."]}
        result = captions(self.task, self.config, generator=lambda *_: self.fail("no model call"))
        self.assertEqual(result["captions"], [])

    def test_caption_review_validates_the_draft_and_uses_selection_context(self):
        entries = [{"receipt_id": R1, "caption": "Engraving, 1591.", "alt_text": "Engraving."},
                   {"receipt_id": R2, "caption": "Map, 1591.", "alt_text": "Map."}]
        draft = captions(self.task, self.config, generator=self.model(entries))
        review_task = copy.deepcopy(self.task)
        review_task.update(role="reviewer", agent_config={**self.task["agent_config"], "role": "reviewer"})
        review_task["input"].update(work_item={"id": "captions-factcheck", "specialty": "factcheck"}, draft_result=draft)
        seen = []

        def generate(task, config):
            seen.append(task["input"])
            return {"candidate": {"verdict": "changes-requested", "issues": [f"{R1}: the artist is named in metadata."]}}
        review = reviewer(review_task, self.config, generator=generate)
        self.assertEqual(review["verdict"], "changes-requested")
        self.assertIn("image_selection", seen[0])
        tampered = copy.deepcopy(review_task)
        tampered["input"]["draft_result"]["captions"][0]["image"]["artist"] = "Someone else"
        with self.assertRaises(EvidenceError):
            reviewer(tampered, self.config, generator=generate)

    def test_gateway_caption_schema_binds_ids_and_exact_count(self):
        calls = []

        def transport(request, timeout):
            calls.append(json.loads(request.data))
            from io import BytesIO
            return BytesIO(b'{"choices":[{"message":{"content":"{}"}}]}')
        generate_candidate(self.task, self.config, open_request=transport)
        schema = calls[0]["response_format"]["json_schema"]
        self.assertEqual(schema["name"], "terraveler_editorial_captions")
        items = schema["schema"]["properties"]["captions"]
        self.assertEqual((items["minItems"], items["maxItems"]), (2, 2))
        self.assertEqual(items["items"]["properties"]["receipt_id"], {"enum": [R1, R2]})
        self.assertIn("You cannot see the images", calls[0]["messages"][2]["content"])

    def test_photo_editor_queries_come_from_research_summary_without_full_snapshots(self):
        self.task.update(role="research", agent_config={**self.task["agent_config"], "role": "research"})
        self.task["input"] = {"graph_run_id": 4, "work_item": {"id": "iconography-images", "specialty": "iconography"},
                              "dependency_research": [{"work_item_id": "route", "result": {
                                  "findings": [{"text": "The survivors reached the Timucua."}],
                                  "references": [{"id": "mcp:1", "text": "x" * 5000}],
                                  "waypoints": [{"place_historical": "Apalache", "place_modern": "Tallahassee, Florida"}]}}]}
        summary = research_summary(self.task)
        self.assertEqual(summary["places"], ["Apalache", "Tallahassee, Florida"])
        seen = []

        def generate(task, config):
            seen.append(task["input"])
            return {"candidate": {"queries": ["Apalache", "Timucua"]}}
        iconography(self.task, self.config, call_tool=lambda n, a: {"candidates": []}, generator=generate)
        self.assertEqual(seen[0]["research_summary"]["findings"], ["The survivors reached the Timucua."])
        self.assertNotIn("dependency_research", seen[0])
