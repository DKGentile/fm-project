/**
 * One-click chat prompts. They're generic on purpose — you're signed in as a
 * specific customer, so the agent answers about *your* orders. (Which policy
 * scenario you see depends on which demo account you logged in as.)
 */

export interface Scenario {
  label: string;
  text: string;
}

export const SCENARIOS: Scenario[] = [
  { label: 'See my orders', text: 'What orders do I have, and which are eligible for a refund?' },
  { label: 'Return an item', text: "I'd like to return one of my recent orders." },
  { label: 'Damaged on arrival', text: 'My item arrived damaged — I want a refund.' },
  { label: 'Check eligibility', text: 'Is my most recent order eligible for a refund?' },
];

export const EXAMPLE_PROMPT = SCENARIOS[0].text;
