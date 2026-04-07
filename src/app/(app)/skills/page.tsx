export const dynamic = 'force-dynamic';

import { listSkills } from '@/lib/actions/skills';
import { listProjects } from '@/lib/actions/projects';
import { SkillsClient } from './skills-client';

export default async function SkillsPage() {
  const [skills, projects] = await Promise.all([listSkills(), listProjects()]);

  const globalSkills = skills.filter((s) => s.scope === 'global');
  const projectSkills = skills.filter((s) => s.scope === 'project');

  return <SkillsClient globalSkills={globalSkills} projectSkills={projectSkills} projects={projects} />;
}
