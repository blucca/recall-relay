# Source notes — U.S. CPSC recall 25-247

## Scope and dates

`recall.json` curates one historical official recall: SharkNinja Foodi OP300-series multi-function pressure cookers, announced **May 1, 2025**. The public sources were read on **October 8, 2026**. `recallDate` stores the original announcement date; `retrievedAt` stores the October 2026 CPSC/claim-page retrieval time, in UTC.

The initial product scope is the **12 models explicitly listed in the U.S. CPSC notice**. The manufacturer runs a combined U.S./Canada program. Its additional listed models are **OP300C, OP301C, and OP305CCO**. These remain outside this curated U.S. matching list and retain their separate geographic/source context.

The recall covers the pressure-cooking lid. Its official remedy stops pressure cooking and permits continued air frying and other functions. CPSC also includes OP300-series pressure-cooking lids purchased separately as additional parts.

## Authorities

| Source | Role | Read time (UTC) |
| --- | --- | --- |
| [CPSC 25-247](https://www.cpsc.gov/Recalls/2025/SharkNinja-Recalls-1-8-Million-Foodi-Multi-Function-Pressure-Cookers-Due-to-Burn-Hazard-Serious-Burn-Injuries-Reported) | Announcement, U.S. model list, additional-code example, affected function and remedy | 2026-10-08 14:23:47 |
| [SharkNinja recall program operated by RQA](https://www.rqa-inc.com/client/SharkNinja/) | Ownership transfer guidance, replacement procedure, detailed disposal FAQ | 2026-10-08 14:22:12 |
| [Manufacturer replacement-lid form](https://www.rqa-inc.com/client/SharkNinja/SubForm/index.html) | Region, product-label photo, serial/model, recipient details, owner declaration, confirmation email | 2026-10-08 14:23:47; form HTML re-read 14:32:19 |

The CPSC notice links to the RQA program. [SharkNinja's own recall page](https://www.sharkclean.com/ninjaus/support.OP300_recall) presents the same program. `manufacturerUrl` follows the program URL named by CPSC; `claimUrl` follows its official form link.

## Interpretation used in the product

- **Identifier handling.** The CPSC example maps the full label `OP301 I07` to model `OP301`. The separately printed code remains part of the captured raw label. Letters within actual listed models, including `OP301A` and `OP305CO`, remain part of those model names. This source-backed rule applies to this recall.
- **Label position.** CPSC describes a label on the side of the cooker; the live form asks for the rear product label. Claim preparation follows the form's specific photo instructions.
- **Transferred ownership.** The manufacturer's FAQ asks a former owner to forward the recall notice to the person who received or bought the cooker. Recall Relay represents this as a portable product/recall handoff, followed by label confirmation by the current holder.
- **Disposal sequencing.** The program's headline guidance says to remove and discard the lid and complete the form. Its detailed FAQ says to register, then discard the old lid under local requirements; the form's owner declaration describes future removal and disposal. The curated instructions preserve that detailed FAQ sequence while keeping pressure cooking stopped throughout. Photo evidence concerns the unit's rear label.
- **Form evidence.** The live HTML marks recipient name, repeated email, telephone, country, street address, city, state/province, postal code, model selection, and serial as required fields. It offers camera capture and photo upload. The owner declaration addresses old-lid disposal and replacement-lid use. Generic template fields retained inside HTML comments are excluded from the curated requirements.
- **Progress meaning.** Form preparation, owner-reported manufacturer acknowledgement, replacement arrival, old-lid disposal, and replacement installation have distinct states. Owner acknowledgement records the owner's report of an official confirmation.

## Demonstration provenance

Household characters, transfer stories, model-entry examples, progress events, acknowledgement references, and dates chosen inside the simulator are **demonstration or owner-reported data**. The official recall facts and source quotations are separately identified. A person completes a real claim on the manufacturer's website using their own product and recipient information.

The published data contains concise factual paraphrases and short attributed excerpts. Original source snapshots remain in the development workspace's temporary research directory. The digest below summarizes the curated excerpts and supports detecting changes to this version.

## Curated excerpt digests

For each source URL, take its `quotes[].text` values in array order, join them with one LF (`\n`) between entries, encode as UTF-8 with zero trailing LF, and compute SHA-256. These digests identify the curated source excerpts in this dataset.

| Source | Quote IDs | SHA-256 |
| --- | --- | --- |
| CPSC | `us-model-list`, `additional-code`, `functional-remedy`, `separately-purchased-lids` | `399debe92e7c7dbdbdfa8a2a59b8d3259c1243aa8d4211b1404944ac02dc0693` |
| Manufacturer FAQ | `handoff-forward`, `disposal-after-registration` | `f1af55f43ae11597b550adfd679a84b221af13856ef0c41312d5d733329b5026` |
| Manufacturer form | `label-photo`, `claim-confirmation`, `claim-territory` | `2f788b436f4ac84c14a2860a114b088137d8751e8a11cd4e69a74c0f8c0aa3ef` |
