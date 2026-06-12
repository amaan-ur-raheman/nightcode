import { toolInputSchemas } from '@nightcode/shared';
import { loadSkillContent, loadSkills } from '@/lib/skills';

export async function useSkillTool(input: unknown) {
    const { name } = toolInputSchemas.useSkill.parse(input);
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

export async function listSkillsTool(_input: unknown) {
    const skills = loadSkills();
    return {
        count: skills.length,
        skills: skills.map((s) => ({
            name: s.dirName,
            description: s.description,
        })),
    };
}
