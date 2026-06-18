/**
 * One-click chat prompts. They're generic on purpose — you're signed in as a
 * specific customer, so the agent answers about *your* orders. (Which policy
 * scenario you see depends on which demo account you logged in as.)
 */

export interface Scenario {
  label: string;
  text: string;
  /** 'orders' opens the interactive order picker instead of sending to the agent. */
  action?: 'orders';
}

export const SCENARIOS: Scenario[] = [
  { label: 'See my orders', text: 'Browse your orders and pick one', action: 'orders' },
  { label: 'Return an item', text: "I'd like to return one of my recent orders." },
  { label: 'Damaged on arrival', text: 'My item arrived damaged — I want a refund.' },
  { label: 'Check eligibility', text: 'Is my most recent order eligible for a refund?' },
];
