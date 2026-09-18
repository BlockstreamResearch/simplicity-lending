# One correction to the deployed document, and why it is here

`lending_v3.manifest.json` is apogee's document. It was copied byte for byte on
2026-08-17 — 78859 bytes, SHA-1 `53b36d8dd161` — and carries this deployment's own
values: its factory parameters, its protocol-fee keeper, and the program-id tags its
indexer keys offer detection on. `pnpm check:protocol` recomputes both tags from the
contract sources in this repository, so the pairing is proven rather than assumed.

Two references in it name a namespace that cannot hold them, and both actions that
create something refuse because of it.

| Where                                                           | Says                          | Should say                  |
| --------------------------------------------------------------- | ----------------------------- | --------------------------- |
| `issuance_factory/CreateFactory/outputs[2]/data/parts[0]/value` | `instance.FACTORY_PROGRAM_ID` | `params.FACTORY_PROGRAM_ID` |
| `lending_contract/CreateOffer/outputs[4]/data/parts[0]/value`   | `instance.LENDING_PROGRAM_ID` | `params.LENDING_PROGRAM_ID` |

Both names are declared as **parameters of the same action**, with constant defaults
`dd1e7f89` and `a9b4ade7`. Neither is a field of any class, so neither can be reached
through the deployment namespace. The document says so about itself: the comment beside
the second reference reads "see the LENDING_PROGRAM_ID **param** for how it's derived".

Across all seven published manifests these are the only two `instance.` references
naming something no class declares. Apogee's own runtime never resolves them — it
prepares each action with code written per action rather than by interpreting the
document — which is why the fault survived to be found by the first thing that reads
the document generically.

With the two references corrected, both actions plan completely: the whole deployment,
both issuances, four covenant findings and six outputs.

**What changed and what did not.** Two strings, 78859 bytes to 78855. Nothing else: not
a parameter, not a default, not a program-id tag, not a contract reference, not an
amount. The values those two references resolve to are identical either way — the same
two four-byte tags — so the record written into the transaction is byte for byte what
the deployed indexer expects. The correction changes how the document names them, never
what they are.

**Where the fix belongs.** Upstream, in apogee. This copy carries it so the protocol can
be performed now; when apogee corrects its own document, this file is replaced from it
again and this note goes.

**Still needed, re-checked on 2026-09-18** against humid `7ef0dab`, the review response
to PRs #20 to #29. The wallet reads an `instance.` reference from the deployment's own
fields and nowhere else — `packages/tx-manifest/src/document/references.ts`, the
`instance` case of `lookUp` — so a reference naming an action parameter still resolves
against nothing. What did change is the other direction: a value supplied in the request
now satisfies a bare reference to a declared field of the same name, in
`instanceReferences`, which is what lets the six deployment actions send `params {}` and
leave the rest to the wallet. Neither of those makes this correction unnecessary.
