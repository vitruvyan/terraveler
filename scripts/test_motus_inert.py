#!/usr/bin/env python3
"""v0.10.0 ships a CommitmentLog, a BEGIN/END run lifecycle and a checkpoint-
cadence module (commitlog.py, commitments.py, sealing.py) beside the runtime
that already shipped in 0.8.1/0.9.0. ADR-021 decision 1 says an unconfigured
Runtime is "bit-for-bit 0.8.1" and that none of the new modules is even
imported unless an embedder passes `commitments=` or `witness=`.

Terraveler passes neither -- desk_graph.run_desk() builds `Runtime(SPEC,
make_nodes(cfg), policy=policy, sink=sink)`, nothing else. This test does not
take ADR-021's word for that. It runs a graph in a fresh subprocess -- module
state does not leak between processes, so this cannot pass by accident of
import order -- and reads sys.modules back after the run completes.

    python3 -m unittest test_motus_inert -v          (from scripts/)
"""
from __future__ import annotations

import subprocess
import sys
import textwrap
import unittest

#: The modules v0.10.0 adds over v0.9.0 (git diff v0.9.0..v0.10.0 --stat).
#: None of the three is imported by `vitruvyan_motus/__init__.py`, and
#: `commitlog` is not imported anywhere under `src/` at all -- only an
#: embedder who wants a CommitmentLog imports it, which is exactly what makes
#: "not configured" mean "not loaded" rather than "loaded and idle".
NEW_IN_0_10_0 = (
    "vitruvyan_motus.commitlog",
    "vitruvyan_motus.commitments",
    "vitruvyan_motus.sealing",
)

# A minimal graph, deliberately not desk_graph's: this is a claim about the
# KERNEL, not about any one Terraveler pipeline, so it must hold with zero
# Terraveler code on the path -- no psycopg2, no database, no stub.
PROBE = textwrap.dedent("""
    import sys
    from vitruvyan_motus import GraphSpec, InMemoryTraceSink, Policy, Runtime, State

    SPEC = GraphSpec.from_dict({
        "schema_version": "1.0.0",
        "name": "inert-probe",
        "version": "1.0.0",
        "entry": "noop",
        "nodes": [{"name": "noop", "effect_class": "pure",
                   "reads_declared": [], "writes_declared": []}],
        "transitions": {"noop": {"kind": "terminal"}},
    })

    def noop(state, ctx):
        return state

    # No commitments=, no witness= -- the exact configuration desk_graph.py
    # runs production verdicts under.
    runtime = Runtime(SPEC, {"noop": noop}, policy=Policy.STRICT,
                       sink=InMemoryTraceSink())
    result = runtime.run(State.new("inert-probe"), run_id="inert-probe-1")
    assert result.trace.root is not None, "a one-node completed run should have a root"
    print("ROOT", result.trace.root)
    for name in sorted(sys.modules):
        if name.startswith("vitruvyan_motus"):
            print("LOADED", name)
""")


class TheUnconfiguredRuntime(unittest.TestCase):
    """ADR-021 decision 1: 'everything here is off unless configured, and off
    means bit-for-bit today' -- checked, not trusted."""

    def test_a_run_with_no_commitments_and_no_witness_loads_no_v0_10_0_module(self):
        proc = subprocess.run(
            [sys.executable, "-c", PROBE], capture_output=True, text=True,
            timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        loaded = {line.split(" ", 1)[1] for line in proc.stdout.splitlines()
                  if line.startswith("LOADED ")}
        # The probe must have actually run the runtime, or an empty `loaded`
        # would pass this test for the wrong reason.
        self.assertIn("vitruvyan_motus.runtime", loaded)
        self.assertIn("vitruvyan_motus.graph", loaded)
        for module in NEW_IN_0_10_0:
            self.assertNotIn(
                module, loaded,
                f"{module} was loaded by a Runtime configured with neither "
                "commitments= nor witness= -- ADR-021 decision 1 does not hold")


if __name__ == "__main__":
    unittest.main(verbosity=2)
