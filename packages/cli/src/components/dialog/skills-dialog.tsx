import { useMemo, useCallback } from 'react';

import { useDialog } from '@/providers/dialog';
import { DialogSearchList } from '@/components/dialog-search-list';
import { loadSkills, type Skill } from '@/lib/skills';

type SkillsDialogContentProps = {
    onSelectSkill: (value: string) => void;
};

export function SkillsDialogContent({
    onSelectSkill,
}: SkillsDialogContentProps) {
    const dialog = useDialog();
    const skills = useMemo(() => loadSkills(), []);

    const handleSelect = useCallback(
        (skill: Skill) => {
            dialog.close();
            onSelectSkill(`/skill:${skill.dirName} `);
        },
        [dialog, onSelectSkill],
    );

    return (
        <DialogSearchList
            items={skills}
            onSelect={handleSelect}
            filterFn={(skill, query) =>
                skill.name.toLowerCase().includes(query.toLowerCase()) ||
                skill.description.toLowerCase().includes(query.toLowerCase())
            }
            renderItem={(skill, isSelected) => (
                <text selectable={false} fg={isSelected ? 'black' : 'white'}>
                    {skill.name}
                </text>
            )}
            getKey={(skill) => skill.name}
            placeholder="Search skills"
            emptyText="No skills found in ~/.agents/skills"
        />
    );
}
