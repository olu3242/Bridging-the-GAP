# BTG visual learning system · version 1

Status: design and prototype review, not production certification. This system
extends the canonical curriculum; it does not change lesson IDs, objectives,
examples, practice, sequencing, grading or competency authority.

## 1. Master identity and color

Use the existing application's dark indigo surfaces, violet brand and cyan
accent. The export palette is an sRGB companion for portable HTML/SVG:
background `#141724`, raised surface `#202538`, text `#F5F6FA`, secondary text
`#CBD2E1`, border `#66728C`, violet `#C4B5FD`, cyan `#67E8F9`.
Keep diagrams flat. One dominant idea per frame, generous negative space,
two-dimensional line work, no ambient glow, stock robots or decorative gradients.
Domain accents identify subjects; semantic colors identify states. They are
different systems. Meaning always also has a written label and border/icon cue.

| Meaning | Color | Redundant visual cue |
|---|---|---|
| AI proposal | violet `#C4B5FD` | dashed border; “Proposed” |
| Human review | blue `#93C5FD` | diamond icon; “Review” |
| Verified | green `#86EFAC` | check and solid double border |
| Pending | amber `#FDE68A` | clock and dotted border |
| Warning | amber `#FDE68A` | triangle and “Check” |
| Failed | rose `#FDA4AF` | cross and “Failed” |
| Denied | rose `#FDA4AF` | barred gate and “Denied” |
| Evidence | cyan `#67E8F9` | document and source reference |
| Persistent data | cyan `#67E8F9` | cylinder and “Stored” |
| External service | slate `#CBD2E1` | enclosing boundary and outward arrow |

## 2. Typography, spacing and components

App: existing Geist/system sans and Geist/system monospace. Portable exports:
system sans, no remote font dependency. Display 40/48px, lesson title 32/40,
diagram heading 24/32, node 18/26, annotation/caption/chart label 16/24.
Never rasterize paragraphs. HTML contains the complete explanation.
Spacing scale: 4, 8, 12, 16, 24, 32, 48px. Panel radius 16px, diagram node 12px.
Borders 2px; focus 3px cyan with 3px offset. No shadow needed for teaching
diagrams; use borders and spacing to express grouping. Desktop visual width
960px; mobile reflows at 600px into one column, with optional native details
for explanation. No hover-only meaning or obligatory animation.

## 3. Icons and diagram grammar

Reuse the application's Lucide icon family: BrainCircuit (model), UserRound
(learner), ClipboardCheck (reviewer), GraduationCap (instructor), Settings
(operator), Bot (agent), MessageSquare (prompt), Layers (context), BookOpen
(source), FileCheck (evidence), CircleCheck (verified), TriangleAlert (warning),
CheckCheck (approval), Wrench (tool), Network (API), Database (data), Cloud,
LockKeyhole (lock), ListChecks (assessment), RotateCcw (retry), GitBranch
(workflow), FolderKanban (project), Target (competency), Award (credential),
BriefcaseBusiness (career), FolderOpen (portfolio). Icons accompany text.
Exports use simple equivalent line symbols, never a pictogram as the sole label.

An arrow means a directed handoff, not causality unless labeled. A dashed arrow
means a proposal. A diamond is an explicit human decision. A cylinder means
persistent data, never model memory. An external boundary has an outward marker.
A barred arrow terminates a denied action. A return arrow labels the retry
condition and maximum, if the canonical content specifies it. An escalation
arrow names the responsible role. Never imply that an AI proposal authorizes
execution, that viewing proves learning, or that submission grants mastery.

## 4. Domain language

| Domain | Accent | Motif and subject language |
|---|---|---|
| D01 | violet | patterns, models, grounding, explicit verification boundary |
| D02 | cyan | documents, planning lanes, review and time |
| D03 | lavender | bounded instruction blocks and context filters |
| D04 | blue | tool paths, state, approval gates and retries |
| D05 | cyan | layered frontend/API/data, diffs and tests |
| D06 | green | tables, honest axes, missing values and uncertainty |
| D07 | blue | infrastructure boundaries, health and recovery |
| D08 | rose | identity gates, ownership and least privilege; no hooded hackers |
| D09 | amber | portfolio evidence, contribution and role requirements |
| D10 | amber | hypotheses, small experiments and observed outcomes |
| D11 | lavender | repository, specification, diff, test, deployment and observation |

D11 always preserves **AI output ≠ verified software**. African learners, when
shown, appear naturally in contemporary libraries, labs, campus collaboration,
startups and remote work. No tokenism, poverty framing, costume motifs unrelated
to the lesson, or imported generic corporate stock aesthetic. These prototypes
use diagrams and worksheets; they make no demographic claims through imagery.

## 5. Five templates and media selection

| Slot | Learning question | Structure | Placement |
|---|---|---|---|
| cover | What are we learning? | One subject motif, title-safe space, short labels | After introduction |
| concept | How does it work? | Labeled process, comparison, relationship or decision map | Beside concept |
| worked_example | What happens in this authored case? | Canonical scenario and inspectable trace | Beside worked example |
| misconception | Which mistake must I avoid? | Explicit assumption, correction and decision boundary | At verification section |
| practice_evidence | Can I demonstrate it? | Worksheet with prompts and evidence fields | Beside practice |

Project lessons replace the fifth template with a project evidence board:
objective, required artifacts, verification, acceptance criteria, submission
components, blockers and definition of done. Blank fields are learner work,
not fabricated results. No worksheet confers submission or completion.

Choose SVG/semantic HTML for precise flows, architecture, comparisons and
tables. Charts require actual canonical values or explicitly labeled synthetic
inputs; otherwise use a qualitative scale illustration without invented rates.
Use real screenshots only when that exact interface matters and provenance is
available. Use interaction only when manipulating a variable teaches something.
Use image generation for editorial people/metaphor covers, not text-heavy
technical diagrams. The first reference covers use diagrammatic subject marks;
no image-generation output is being claimed.

## 6. Metadata, manifest and storage

`schema.mjs` defines the executable asset/manifest contract and exports JSON
Schema. `build.mjs` derives all target slots from the canonical lesson catalog.
Every asset records curriculum/activity/lesson/domain IDs, slot, purpose, title,
caption, alt text, extended description, format, paths, dimensions, aspect ratio,
source type, generation prompt/model, source hash and references, status,
version, and creation/review/publication metadata. Unknown values remain null.
Pending mappings have null asset/thumbnail paths: a reserved path is not a file.

Canonical path:
`curriculum/assets/visuals/AF/AF01/concept/generated/AF01-concept-v1.html`.
Keep `source`, `generated`, `approved`, `published` stages separate. Thumbnails
use `-thumbnail-v1.svg`. Each lesson has `manifest.v1.json`. Manifests reference
asset IDs; the UI resolves authorized published metadata, never guessed URLs.
Do not overwrite approved/published bytes; use a new asset version and review.
Content hashes bind visual review to exact curriculum source and asset bytes.
Storage import must use the existing file registry, ownership checks and
publication authorization. Local generated files are not public CDN URLs.

## 7. Accessibility, responsive layout and performance

Every visual provides meaningful alt text, a caption and a full semantic
equivalent, including the actual canonical scenario. Complex diagrams include
an extended description. Text contrast target is 4.5:1; essential non-text
boundaries 3:1. Test color pairs, monochrome meaning, keyboard navigation,
200% zoom, 320px/390px/768px/1440px widths and reduced motion. Labels never
depend on color. Tables have captions and scoped headers. Practice boards are
printable and can be copied into the existing submission, without pretending
that local editing is a persisted attempt.

Reflow nodes instead of shrinking labels. Keep bounded scroll only for an
intrinsically wide data table, with its semantic equivalent nearby. Below-fold
assets load lazily; only a critical cover may preload. HTML/SVG needs no raster
breakpoints; raster production requires 480/960/1440px variants and a thumbnail.
On file or render failure show “Visual unavailable” and the canonical text.
Missing imagery never hides core instruction or changes academic state.

## 8. Generation prompt contract

Each manifest contains a prompt assembled from public canonical content only:
lesson ID/title/domain, slot, objective, purpose, exact source material, visual
story, required/optional/prohibited elements, BTG style, domain accent, minimal
label policy, accessibility, format/aspect ratio and intended output. Never
include protected keys, expected assessment answers, private learner records,
invented statistics, companies, outcomes or credentials. Deterministic renderers
record their renderer version; generation model is null when not used.

## 9. Human review and lifecycle

Lifecycle: draft → generation_pending → generated → needs_review → approved →
published; generated/needs_review may be rejected; published may be retired.
Regeneration uses a new revision rather than altering approved content. An
authorized human content reviewer evaluates pedagogy, accuracy, provenance,
brand, accessibility and responsive behavior. Record reviewer identity, time,
reason and artifact/source hashes. Publication rechecks these records and
uses the existing audit/workflow authority. Generated files and automated QA
cannot supply human approval. Retired content remains linked to history.

## 10. QA, rollout and definition of done

Automated gates: canonical lesson/domain identity; exactly five unique slots;
stable asset IDs; versions/source hashes; schema validity; approved-state
metadata; file/thumbnail existence; safe paths; allowed formats; alt/caption/
description; dimensions/aspect ratio; no scripts or remote references in
portable prototypes; contrast; responsive browser renders; no protected keys.
Negative tests deliberately corrupt those contracts. A published asset must
resolve, render, retain review provenance and match its approved bytes.

Stage 0 establishes this system. Stage 1 builds five reference visuals each for
AF01, PC07, AA07, SE10, DA08, CS03, EI06 and VC10. Review all forty before broad
production. Then run cover, concept, worked-example, misconception and practice
waves in that order, grouped by domain (8–14 lessons). Count targets from
catalog × slots. Report mapped, rendered, reviewed and published separately.
Do not label the remaining pending slots as missing completed artwork.

The system is certified only when source fidelity, accessibility, rendering,
responsive behavior, immutable provenance and human review are all evidenced.
The rollout is complete only when every target has an existing, reviewed,
published asset. No visual changes grades, progress, evidence, mastery or
credential eligibility. This document is a contract, not a claim of those results.
