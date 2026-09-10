# Security debt surfaced by CI

The GitHub Actions workflow introduced with universal agent onboarding runs
`npm ci`, which currently reports **5 dependency advisories: 3 high and 2
critical**.

This file is a marker, not a vulnerability assessment. The package manager's
severity alone does not establish exploitability in Terraveler: each advisory
must be mapped to the exact package/version, dependency path, runtime exposure
and available non-breaking remediation.

Do not run `npm audit fix --force` as a blanket response. Breaking framework or
runtime upgrades belong in a reviewed change with the normal build and product
regression suite.

Follow-up should:

1. capture `npm audit --json` on a clean install;
2. classify direct vs transitive and production vs development dependencies;
3. identify whether vulnerable code is reachable in Terraveler's deployment;
4. apply non-breaking upgrades first;
5. isolate any breaking upgrade in its own PR with tests/build/runtime smoke;
6. record accepted residual risk if no safe patch exists yet.
