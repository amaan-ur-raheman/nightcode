import { toolInputSchemas } from '@nightcode/shared';
import { loadSkillContent, loadSkills } from '@/lib/skills';

export async function useSkillTool(input: unknown) {
    const parsed = toolInputSchemas.use_skill.parse(input);
    const { action, name } = parsed;

    if (action === 'list') {
        const skills = loadSkills();
        return {
            count: skills.length,
            skills: skills.map((s) => ({
                name: s.dirName,
                description: s.description,
            })),
        };
    }

    if (action === 'use') {
        if (!name) throw new Error('name is required for use action');
        const content = loadSkillContent(name);
        if (!content) {
            const skills = loadSkills();
            const available = skills.map((s) => s.dirName).join(', ');
            return {
                error: `Skill "${name}" not found. Available skills: ${available}`,
            };
        }
        return { name, content };
    }

    throw new Error(`Unknown action: ${action}`);
}
