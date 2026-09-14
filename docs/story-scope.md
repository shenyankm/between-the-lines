# Current story scope

This release focuses on the three-act workplace story: the farewell invitation, procurement obstruction, and workplace rumors, followed by six fact-based endings. Sun, Li and Zhang remain the three conversational NPCs; Wang's existing farewell contact remains available. The release does not add a partner or family storyline or a new AI NPC.

Private boundaries with Sun belong to the workplace story. A player may retain friendship, keep only professional contact, or defer that choice. This is distinct from making a decision about a romantic partner. Finishing an act does not imply breakup, reconciliation, accepting family advice, disclosing private matters, or emotional closure.

The backend retains `partner_breakup`, `partner_distance`, and `partner_undecided` identifiers for compatibility with explicit historical actions and isolation tests. They are not exposed in the current player UI or NPC action catalogue, and the current authored scenes never invoke them automatically. Their presence in a schema is not an advertised playable branch. Existing recorded choices remain preserved and private; we do not rewrite the original source document.

A future optional private-life scene would need its own product decision, visible and skippable choices, reconsideration rules, permission tests and content revision. It is outside this release. This scope clarification adds no story facts and introduces no new rules; new revision 3 and existing revision 2 continue to use the same workplace scenes.
