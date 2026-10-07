import { AI_DRAFT_MARKER } from '@/lib/playground'

/**
 * What the playground's "Copy AI instructions" button puts on the clipboard.
 * Someone pastes it after their own prompt in any chat AI, and the answer
 * opens in the playground through Paste or Open file.
 *
 * Every rule here matches something the reader in dependency-markdown.ts does:
 * numbered lines are dropped once a list has bullets, a repeated name is
 * skipped, square brackets are read as tags, and commas split a needs list.
 * Levels stop at L2 while what L3 means is still undecided.
 */
export const AI_INSTRUCTIONS = `---
Instructions for your answer (from FeaturePlus):

Turn the project I described above into a list of features that I can open in FeaturePlus. Follow this format exactly.

Format:
- Put the whole answer in one code block, with nothing before or after it.
- The first line inside the code block must be exactly: ${AI_DRAFT_MARKER}
- The second line is the project name, as a heading: # Project name
- After that, one feature per line, each starting with "- " (a dash and a space).
- To put a feature inside another one, indent it two spaces more than the feature it belongs to.
- When a feature cannot be built until another one exists, add " > needs: " and the other feature's exact name at the end of the line. Separate several names with commas.

Levels:
- Top-level features (no indent) are the main areas of the project.
- A feature may contain smaller features, and those may contain smaller ones again. Never go deeper than that: three levels at most.
- Only split a feature when it really has separate parts that could be built one at a time. Most features stop at the first or second level, and many have no smaller features at all. That is normal.
- Never add a smaller feature just to fill a level, and never give a feature a smaller feature with almost the same name.

Names:
- Every feature name must be unique across the whole list.
- Keep names short: two to five words, naming what the feature does.
- Plain text only: no numbering, no bold, no square brackets, no commas, and do not use the word "needs" in a name.
- No descriptions, notes or explanations, only the names.

Dependencies:
- Only add "needs" when one feature truly cannot work without the other. Leave it out when unsure.
- A feature must not need a feature inside it, or the feature it sits inside.

Example of the format:

\`\`\`
${AI_DRAFT_MARKER}
# Recipe Sharing App
- Accounts
  - Sign up
  - Log in
- Recipes > needs: Accounts
  - Create recipe
    - Ingredient list
    - Step photos
  - Browse recipes
- Search > needs: Recipes
- Favorites > needs: Accounts, Recipes
- Dark mode
\`\`\`
`
