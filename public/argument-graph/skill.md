---
name: argument-graph
description: Extract an argument map from educational text. Given a URL or PDF path, scrapes/parses the content, then runs a three-pass LLM pipeline to extract claims, evidence, and logical connections as a JSON graph.
---

# Argument Graph Extraction

Given a source (URL or PDF path), extract a structured argument map: a graph of atomic claims and evidence nodes connected by logical edges, grounded in specific text spans.

## Inputs

- `SOURCE`: a URL or an absolute path to a PDF file
- `OUTPUT_PATH` (optional): where to write the final JSON (default: `argument_graph.json`)

## Step 0 — Ingest the source

Run the ingestion script and pipe its output into `source.md`:

```bash
uv run --with trafilatura --with pymupdf4llm python3 scripts/ingest.py "$SOURCE" > source.md
```

Progress and errors go to stderr. If the exit code is non-zero or `source.md` is empty, report the error and stop.

The script wraps each paragraph in `<span id="p-N">...</span>` so that grounding citations in the extracted graph map directly to stable HTML anchors in the rendered document.

## Step 1 — Full extraction (Call 1)

Read `source.md` in full. Then produce a structured extraction of all claims and edges in a single pass.

Reason through the text section by section in a scratchpad before emitting any JSON. For each section ask: what is the author asserting here, what are they assuming, and what evidence are they offering?

### Node types

| type | meaning |
|---|---|
| `thesis` | The central claim the section or text is arguing for |
| `supporting_claim` | A claim that directly supports a thesis or another claim |
| `empirical_finding` | A result from a study, experiment, or dataset cited as evidence |
| `definition` | A concept being formally defined that other claims depend on |
| `assumption` | A premise the argument relies on but does not argue for |

### Edge types

| type | meaning |
|---|---|
| `supports` | Source node provides evidence or reasoning for target |
| `contradicts` | Source node is in tension with target |
| `elaborates` | Source node adds detail or nuance to target without adding new support |
| `is_evidence_for` | Source is an empirical finding offered as direct evidence for target |
| `assumes` | Target claim is a prerequisite assumption of source |
| `follows_from` | Source is a logical consequence of target |

### Output schema (Call 1)

```json
{
  "reasoning": "<scratchpad: walk through the text section by section>",
  "nodes": [
    {
      "id": "n1",
      "type": "<node type>",
      "statement": "<single assertable sentence>",
      "grounding": {
        "paragraph_id": "<id from the <span> tag in source.md, e.g. 'p-14'>",
        "quote": "<short verbatim or near-verbatim span from that paragraph — mandatory unless the node spans multiple paragraphs>"
      }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "n1",
      "target": "n2",
      "type": "<edge type>",
      "reasoning": "<one sentence justifying this edge>"
    }
  ]
}
```

Write this to `graph_v1.json`.

## Step 2 — Critique pass (Call 2)

Read `source.md` and `graph_v1.json`.

Act as a critic. Do not rewrite the graph — produce a structured list of proposed changes only. For each issue give a type, a description, and a concrete suggested action.

### Issue types to look for

- **redundant**: two nodes express essentially the same claim and should be merged
- **too_abstract**: a node's statement is not grounded in anything specific in the text; it needs re-grounding or splitting
- **missing_assumption**: an edge A→B requires an implicit premise C that is not represented as a node
- **implausible_edge**: an edge is not well supported given the text
- **ungrounded_chunk**: a section of the text has no node grounded in it (possible extraction gap)

### Output schema (Call 2)

```json
{
  "reasoning": "<overall assessment of the graph's quality>",
  "issues": [
    {
      "id": "i1",
      "type": "<issue type>",
      "affects": ["n2", "n5"],
      "description": "<what is wrong>",
      "suggested_action": "<what to do: merge n2 into n5 / add node for X / remove edge e3 / etc.>"
    }
  ]
}
```

Write this to `critique.json`.

## Step 3 — Revision (Call 3)

Read `graph_v1.json` and `critique.json`.

Apply the suggested changes from the critique. For each issue, either apply it or explicitly skip it with a reason. Produce the final revised graph.

### Output schema (Call 3)

```json
{
  "reasoning": "<summary of what was changed and what was skipped and why>",
  "changes_applied": ["i1", "i3"],
  "changes_skipped": [
    { "issue_id": "i2", "reason": "<why this was not applied>" }
  ],
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

Write the final graph to `$OUTPUT_PATH` (default: `argument_graph.json`).

## Step 4 — Report

Print a brief summary:
- Number of nodes by type
- Number of edges by type
- Any critique issues that were skipped and why
- Path to the output file

---

## Notes

- Keep `source.md`, `graph_v1.json`, and `critique.json` as intermediate artifacts — they are useful for debugging and for re-running individual steps.
- For texts under ~5000 words, all three LLM calls can use the full `source.md` in context without chunking.
- For longer texts, segment `source.md` by heading before Call 1 and run extraction per segment, then merge before Call 2.
- The `reasoning` field in each call is load-bearing — it forces the model to build up understanding before committing to structured output. Do not omit it or move it after the structured fields.
- **Grounding design:** `paragraph_id` is the ground truth for viewer navigation — it maps directly to a `<span id="p-N">` anchor in `source.md`. The `quote` field is for human readability and loose correctness checking (if the quote doesn't appear in or near the cited paragraph, the LLM has likely cited the wrong id). A viewer can render `source.md` as HTML and jump to `#p-N` with a single `scrollIntoView` call. The `quote` field is mandatory except when a node's grounding genuinely spans multiple paragraphs, in which case cite the id of the most relevant one and note the spread.