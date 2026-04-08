import type { WorkflowId } from '@/lib/orchestration/workflow-selector';

export interface RoutingEvalFixture {
  name: string;
  title: string;
  description: string;
  historicalScorecard?: {
    workflowId: WorkflowId;
    taskCount: number;
    escalationFrequency: number;
    verificationFailureRate: number;
    approvalFrequency: number;
  };
  expected: {
    mode: 'single_agent' | 'delegated' | 'delegated_premium' | 'team';
    workflowId: WorkflowId;
    effectiveTier: 'fast' | 'standard' | 'premium';
    floorApplied?: boolean;
  };
}

export const routingEvalFixtures: RoutingEvalFixture[] = [
  {
    name: 'simple-feature-copy-update',
    title: 'Update dashboard empty state copy',
    description: 'Tweak the React empty state component copy on the dashboard page.',
    expected: {
      mode: 'single_agent',
      workflowId: 'featureWorkflow',
      effectiveTier: 'fast',
      floorApplied: false,
    },
  },
  {
    name: 'cross-stack-feature-filter',
    title: 'Add project activity filter to the task dashboard',
    description:
      'Update the Next.js dashboard and API route so task lists can be filtered by project activity.',
    expected: {
      mode: 'delegated',
      workflowId: 'featureWorkflow',
      effectiveTier: 'standard',
      floorApplied: false,
    },
  },
  {
    name: 'high-risk-auth-migration',
    title: 'Migrate auth session enforcement for project routes',
    description:
      'Update auth middleware, token validation, and login flow. Review permissions and security before rollout.',
    expected: {
      mode: 'delegated',
      workflowId: 'highRiskWorkflow',
      effectiveTier: 'premium',
      floorApplied: false,
    },
  },
  {
    name: 'debug-crash-investigation',
    title: 'Debug crash when opening the project board',
    description:
      'Investigate the bug causing an error in the Next.js board page and fix the crash path.',
    expected: {
      mode: 'delegated',
      workflowId: 'debugWorkflow',
      effectiveTier: 'premium',
      floorApplied: false,
    },
  },
  {
    name: 'historical-floor-bump',
    title: 'Rename footer support link',
    description: 'Update the footer UI copy on the landing page.',
    historicalScorecard: {
      workflowId: 'featureWorkflow',
      taskCount: 9,
      escalationFrequency: 0.2,
      verificationFailureRate: 0.45,
      approvalFrequency: 0,
    },
    expected: {
      mode: 'single_agent',
      workflowId: 'featureWorkflow',
      effectiveTier: 'standard',
      floorApplied: true,
    },
  },
];
