# Runtime work

Use Conventional Commits for commits and PR titles.

Read `README.md` for ownership and supported development commands. For format/admission or behavior changes, read `docs/choco-format.md`; update the schemas, both decoders and conformance cases together. For packaging, publication or platform claims, read `docs/releasing.md` and `release-gates.json` first.

This repository owns the shared engine and portable contract. Keep it independently buildable without the private product, credentials or hosted services. The product consumes pinned package artifacts. Preserve the small C interface and thin host adapters; behavior belongs in the shared core.

Prove changes through the public loader/player interfaces and packed consuming applications. Compare native/WASM output on identical inputs. Report actual benchmark workloads and exclusions; sampled frames and simulator timings do not certify physical-device behavior. Preserve boundary validation when optimizing size.

`release-gates.json` records unfinished release work. Keep unsupported targets explicit. Prepare and test artifacts before requesting approval to publish a package; source publication alone does not authorize a production release. Publish the exact reviewed bytes through the release workflow.

Fixtures here are synthetic and redistributable. Customer/community artwork stays in the private product's acceptance suite. Preserve third-party notices and reviewed renderer patch hashes.
