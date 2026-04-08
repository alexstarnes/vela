import { z } from 'zod';

export const routingFixtureSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(''),
  expected: z.object({
    mode: z.enum(['single_agent', 'delegated', 'delegated_premium', 'team']),
    workflowId: z.enum(['featureWorkflow', 'highRiskWorkflow', 'debugWorkflow']),
    tier: z.enum(['fast', 'standard', 'premium']),
  }),
});

export type RoutingFixture = z.infer<typeof routingFixtureSchema>;

export const routingFixtures: RoutingFixture[] = [
  {
    id: 'feature-fast-ui-polish',
    title: 'Polish the tasks page loading state',
    description: 'Update the React page component and Tailwind UI styling for the loading skeleton.',
    expected: {
      mode: 'single_agent',
      workflowId: 'featureWorkflow',
      tier: 'fast',
    },
  },
  {
    id: 'feature-standard-workflow-refactor',
    title: 'Refactor the workflow status summary panel',
    description:
      'Improve the orchestration workflow summary UI across the page layout and server action boundary.',
    expected: {
      mode: 'delegated',
      workflowId: 'featureWorkflow',
      tier: 'standard',
    },
  },
  {
    id: 'high-risk-premium-billing',
    title: 'Refactor billing webhook handling with a database migration',
    description:
      'Update the backend API route, Stripe billing flow, and database schema migration for webhook reconciliation.',
    expected: {
      mode: 'delegated_premium',
      workflowId: 'highRiskWorkflow',
      tier: 'premium',
    },
  },
  {
    id: 'debug-premium-heartbeat',
    title: 'Investigate and debug the production heartbeat scheduler crash',
    description:
      'Diagnose the workflow scheduler error, inspect the backend route, and patch the production incident safely.',
    expected: {
      mode: 'delegated_premium',
      workflowId: 'debugWorkflow',
      tier: 'premium',
    },
  },
  {
    id: 'team-premium-cross-stack-security',
    title: 'Research the auth and payments orchestration rollout',
    description:
      'Research the login token architecture, Stripe checkout workflow, Next.js page and backend API integration, database schema change, and infrastructure rollout across the workflow stack.',
    expected: {
      mode: 'team',
      workflowId: 'highRiskWorkflow',
      tier: 'premium',
    },
  },
];
