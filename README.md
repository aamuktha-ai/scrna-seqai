# scRNA-SeqAI

[Open the public app](https://scrna-seqai.d7bt7qrzfj.chatgpt.site) · [GitHub repository](https://github.com/aamuktha-ai/scrna-seqai)

A standalone CohortAI application for discovering and evaluating public single-cell RNA-sequencing studies against research criteria. This sibling app follows CohortAI-PAN's search-criteria → public-dataset-comparison → exportable-report workflow, with its own source connectors, scientific rubric, catalog, and server.

## Run

Requires Node.js 22 or newer. No npm dependencies are needed.

```bash
cd scrna-seqai
npm run dev
```

Open http://127.0.0.1:5181. Choose **Load example**, then **Search & cross-check datasets** to assess an illustrative human lung study. The app is a local research prototype, not a production institutional service.

## Included repositories

All four requested sources are selectable and have public metadata connectors:

| Source | Retrieved metadata | Important scope |
| --- | --- | --- |
| NCBI GEO | E-utilities series search and summaries, species, sample counts, PubMed links | Up to 50 search results per query. The bundled snapshot uses a broad single-cell RNA query. Live discovery narrows by tissue and species. GEO sample counts are not cell counts or independent donor counts. |
| CZ CELLxGENE Census | Stable Census release membership, joined by dataset ID to current Discover metadata | Membership is checked against release-specific public H5AD object names. Expression files are not downloaded. Current Discover metadata can describe newer versions than the Census release. Only IDs present in both indexes are included. |
| Human Cell Atlas | Paginated project index, organisms, tissues, library protocols, sequencing platforms, publication links | Project-level values can span multiple tissues, assays, and sample subsets. Missing values remain unknown. |
| EMBL-EBI Single Cell Expression Atlas | Experiment index, species, technology, experimental-factor columns | Tissue extracted from titles is explicitly unconfirmed. Reported covariate columns do not establish completeness or harmonized definitions. |

The bundled `reference-data/catalog.json` includes normalized public metadata and per-source retrieval dates, counts, and coverage notes. It is not a copy of the expression datasets or a complete census of every public study. Human and mouse records are retained. Source URLs and linked publications are preserved.

Select **Live repository discovery** to refresh sources for an assessment. GEO receives the selected species and tissue; the other repositories expose public metadata indexes. Source failures are explicitly shown and fall back to the dated bundled snapshot. A successful search with no results stays empty. Server-side live results are cached for one hour.

Update the bundled catalog:

```bash
npm run refresh:catalog
```

The script follows pagination and verifies Census membership. It replaces the snapshot only when all four connectors succeed. It never downloads expression matrices.

## Search without uploads

The interface searches public repositories and cross-checks candidate metadata against research criteria. No investigator dataset or file upload is required or offered. Choose species and tissue, optionally add keywords, cell types, or technical criteria, then select **Search & cross-check datasets**. Live discovery is the default; the bundled snapshot is also available.

In discovery mode, the criteria-fit score is normalized over the criteria you actually specify. Unspecified preferences do not count as mismatches. Missing public evidence for a specified criterion receives zero credit. A high criteria-fit score does not establish integration readiness. Metadata completeness is reported separately across all dimensions. Candidate evidence tables support comparison across public records; the tool does not calculate pairwise matrix compatibility.

## Feasibility report

The transparent, **unvalidated screening heuristic** assesses species (20), tissue (20), library preparation (12), isolation (10), cells/nuclei (8), reads per cell (7), platform (5), annotation schema (6), required covariates (7), and disease/condition (5). Weights total 100.

Unknown information earns zero; inferred tissue earns at most 25% of its weight; partially overlapping multi-valued fields earn partial credit. The display separates compatibility, candidate metadata completeness, and comparable evidence. Completeness does not measure metadata reliability. Scores are not probabilities of successful integration and should not be used as a validated decision rule.

Each candidate includes field-by-field evidence, missing metadata, source links, and conditional next steps for direct integration, reference mapping, or harmonized meta-analysis. Different species or tissues are flagged. Direct integration requires complete compatible labels, verified raw counts, and donor/batch metadata; even then it is only a candidate requiring a pilot and scientific review. Repository indexes rarely supply all of these details, so the app intentionally avoids confident integration recommendations from sparse summaries.

Target cell-type label coverage is described separately; it is not an ontology mapping engine. Tissue and assay normalization is a small explicit alias set, not comprehensive ontology reasoning. Shared accessions or publication links flag possible overlap, but records are retained for source-specific evidence. Other duplicates and shared donors may remain. Counts must not be added across records as if they were independent cohorts.

The scientific question and narrative design notes are retained for optional model review. Deterministic ranking uses structured fields and the explicit keyword filter. Publication URLs are linked evidence, not automatically retrieved or read papers.

Export **CSV** for candidate rankings, or **JSON** for the full assessment, investigator metadata, evidence tables, source provenance, overlap groups, and optional model review. Changing inputs marks the prior report as stale until regenerated.

## Optional LLM review

Copy `.env.example` to `.env` and supply `OPENAI_API_KEY` and `SCRNA_MODEL` for a model available to your account, then restart the server. No model is enabled by default.

The user explicitly opts in before the report's investigator metadata, supplied methods/publication excerpts, and top ten candidate records are sent to OpenAI. Requests use the Responses API with `store: false`. Keys remain server-side. Model review is an additional narrative interpretation; it cannot overwrite deterministic scores or remove evidence flags. Model failures leave the existing report and exports available. The model has no web retrieval tools and must not claim to have read linked publications.

This local app serves an explicit public-file allowlist, limits request size, rejects cross-origin API requests, and does not write investigator submissions to disk. It is not an authenticated multi-user deployment. Institution-specific hosting, authentication, data governance, access auditing, and scientific validation remain necessary before production use.

## Validation

```bash
npm test
```

Tests cover missing metadata, species and material incompatibility, mixed assays, inferred tissue, count representation, covariate gaps, overlap detection, metadata imports, formula-safe CSV export, Census pagination, source failure handling, public-file boundaries, model consent, and mocked model responses. These are software tests, not scientific validation of scoring thresholds. Live LLM behavior requires configured credentials and is not exercised by the test suite.

## Primary references

- [GEO E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/)
- [CELLxGENE Discover API](https://api.cellxgene.cziscience.com/curation/ui/)
- [Census data in AWS](https://chanzuckerberg.github.io/cellxgene-census/cellxgene_census_aws_open_data.html)
- [HCA metadata and project exploration](https://data.humancellatlas.org/guides)
- [Single Cell Expression Atlas](https://www.ebi.ac.uk/gxa/sc/)
- [OpenAI Responses API quickstart](https://developers.openai.com/api/docs/quickstart)
